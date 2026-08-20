// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * An unshielded wallet that registers a variant either side of a protocol boundary and follows the chain across it.
 *
 * @remarks
 *   One wallet, two ledger versions. Before the boundary the pre-fork variant reads the chain with the ledger version
 *   that produced it; from the boundary the post-fork variant does, having been handed everything the pre-fork one held
 *   — which for unshielded is everything, because its UTXOs are public ledger data the wallet keeps as plain records.
 *   Nothing is re-earned from a replay, so the wallet never passes through a state in which it has forgotten what it
 *   owns; `test/forkSimulation.test.ts` proves that, and proves the boundary transaction is applied exactly once, by
 *   the new variant. Which variant is running is the runtime's business, not the application's: the wallet's public API
 *   speaks the post-fork ledger version throughout.
 *
 *   This wallet retains nothing, and that is the honest difference from the shielded and dust wallets. Unshielded
 *   synchronization is watch-only — the address is public and signing is supplied per call by the caller — so
 *   `startSyncInBackground` takes no argument on either variant and there is no key material for a migration to strand.
 *   The one place the two ledger versions genuinely disagree is the _shape_ of a verifying key, and that is resolved
 *   once, at start, by {@link asPreForkPublicKey}.
 */
import type * as v8 from '@midnight-ntwrk/ledger-v8';
import type * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  type NetworkId,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnboundTx,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  type ChainVersionProbe,
  makeIndexerChainVersionProbe,
} from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import * as PreForkSignatures from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { Variant, type VariantBuilder, type WalletLike } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps, HList } from '@midnightntwrk/wallet-sdk-utilities';
import { Duration, Effect, Either, Option, Ref, type Scope, pipe } from 'effect';
import * as rx from 'rxjs';
import { type PublicKey } from './KeyStore.js';
import { type UnsupportedSnapshotVersionError, variantForSnapshot } from './Restore.js';
import {
  type DefaultUnshieldedConfiguration,
  type UnshieldedWalletAPI,
  UnshieldedWalletState,
} from './UnshieldedWallet.js';
import { CoreWallet as PreForkCoreWallet, V1Builder, V1Tag, type V1Variant } from './v1/index.js';
import { type PublicKey as PreForkPublicKey } from './v1/KeyStore.js';
import { type WalletSyncUpdate as PreForkSyncUpdate } from './v1/SyncSchema.js';
import { CoreWallet, Migration, V2Builder, V2Tag, type V2Variant } from './v2/index.js';
import { type SignSegment as PreForkSignSegment } from './v1/Signing.js';
import { type UnboundTransaction as PreForkUnboundTransaction } from './v1/TransactionOps.js';
import { type SignSegment } from './v2/Signing.js';
import { type WalletSyncUpdate as PostForkSyncUpdate } from './v2/SyncSchema.js';
import { type TokenTransfer } from './v2/Transacting.js';
import { type UnboundTransaction } from './v2/TransactionOps.js';
import { type UtxoWithMeta } from './v2/UnshieldedState.js';
import { type WalletError as PreForkWalletError } from './v1/WalletError.js';
import { type WalletError } from './v2/WalletError.js';

/**
 * What restoring a unshielded wallet from a snapshot can fail with.
 *
 * @remarks
 *   Two failures, and they mean different things. The snapshot may declare a protocol version no registered variant
 *   reads, which is a fact about this build of the SDK rather than about the snapshot; or the variant that owns it may
 *   be unable to make sense of the bytes, which is a fact about the snapshot. Either is an ordinary thing to meet when
 *   restoring something a user supplied, which is why `tryRestore` reports them rather than throwing.
 */
export type UnshieldedRestoreError = UnsupportedSnapshotVersionError | PreForkWalletError | WalletError;

/**
 * What a transacting call can fail with.
 *
 * @remarks
 *   Two failures beyond the variant's own: a transaction handed in may have been built on the other side of the boundary,
 *   and a signature the caller's signer returns may name a scheme the pre-fork ledger version does not have.
 */
type TransactingError = WalletError | ProtocolVersionMismatchError | PreForkSignatures.UnsupportedSignatureKindError;

/** The pre-fork variant a forking unshielded wallet registers: the one that reads the chain before the boundary. */
export type PreForkUnshieldedVariant<TSyncUpdate> = V1Variant<string, TSyncUpdate>;

/** The post-fork variant a forking unshielded wallet registers: the one the pre-fork wallet is migrated into. */
export type PostForkUnshieldedVariant<TSyncUpdate> = V2Variant<string, TSyncUpdate, Migration.PreviousLedgerWallet>;

/** The two variants a forking unshielded wallet runs, in registration order. */
export type ForkingUnshieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate> = [
  Variant.VersionedVariant<PreForkUnshieldedVariant<TPreForkSyncUpdate>>,
  Variant.VersionedVariant<PostForkUnshieldedVariant<TPostForkSyncUpdate>>,
];

/**
 * A variant builder registered together with the configuration it alone is built from.
 *
 * @remarks
 *   Per-variant rather than shared, because two variants either side of a protocol boundary can mean different and
 *   mutually unassignable things by the same configuration key — a simulator or a transaction-history service belonging
 *   to one ledger version or the other. A wallet-wide intersection of those is a configuration no single variant can
 *   consume.
 */
export type SelfConfiguredUnshieldedVariant<
  TVariant extends Variant.AnyVariant,
  TConfiguration extends object,
> = Readonly<{
  builder: VariantBuilder.VariantBuilder<TVariant, TConfiguration>;
  configuration: TConfiguration;
}>;

/** What a forking unshielded wallet needs to know about itself, whatever its variants are built from. */
export type ForkingUnshieldedConfiguration = {
  networkId: NetworkId.NetworkId;
  /** The protocol version at which the chain hands over from the pre-fork ledger version to the post-fork one. */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /**
   * How the wallet asks the chain which protocol version it is on, before it chooses a variant to start at.
   *
   * @remarks
   *   Optional, and best-effort where present: a wallet with no probe — or one whose probe does not answer in time —
   *   starts on the pre-fork variant and learns the version from the first message it sees, which is what a wallet with
   *   no history has always done. What a probe buys is the two things that guess costs: a hand-over per start on a
   *   chain entirely past the boundary, and, on a chain that has shown this wallet no messages at all, an epoch that
   *   never gets corrected.
   *
   *   It resolves where a wallet may start, never where it can: an identity only the post-fork ledger version can hold
   *   starts there whatever the chain reports, because there is no decision left to inform.
   *
   *   Nothing about it can make a start fail. A rejection, a timeout, a version no registered variant covers: each
   *   leaves the wallet exactly where a wallet that never asked would be.
   */
  chainVersionProbe?: ChainVersionProbe;
};

/** A running unshielded wallet that spans a protocol boundary. */
export type ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate> = UnshieldedWalletAPI<string> &
  WalletLike.WalletLike<ForkingUnshieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>>;

/** The class a forking unshielded wallet is started from. */
export interface ForkingUnshieldedWalletClass<
  TPreForkSyncUpdate,
  TPostForkSyncUpdate,
  TConfiguration extends ForkingUnshieldedConfiguration = ForkingUnshieldedConfiguration,
> extends WalletLike.BaseWalletClass<
  ForkingUnshieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>,
  TConfiguration
> {
  /**
   * Builds a wallet that watches the chain for an identity.
   *
   * @remarks
   *   There is no secret here and none is wanted: an unshielded wallet reads public UTXO data addressed to an address
   *   anybody could compute, and signing is supplied per call by the caller. What the wallet does have to settle is
   *   which variant can _hold_ the identity, and that turns on the signature scheme — see {@link asPreForkPublicKey}. An
   *   ecdsa identity begins on the post-fork variant, because the pre-fork ledger version has no way to express it.
   *
   *   A schnorr identity can be held by either, so for it the second question is where the chain is. Asynchronous
   *   because answering that can mean asking: with a {@link ForkingUnshieldedConfiguration.chainVersionProbe}
   *   configured, such a wallet starts at the variant that owns the version the chain reports, which on a chain
   *   already past the boundary is the post-fork one from the first moment. Without one, or when the question goes
   *   unanswered, it begins on the pre-fork variant and follows the chain across.
   * @param publicKey The identity to watch, in the post-fork ledger version's shape, which is the one this wallet's
   *   public API speaks.
   * @returns A started wallet, on the variant that can hold the identity and — where both can — the one the chain says
   *   it is on.
   */
  startWithPublicKey(publicKey: PublicKey): Promise<ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>>;
  /**
   * Restores a wallet from a snapshot, into whichever registered variant wrote it.
   *
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, on the variant that owns its protocol version.
   * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
   */
  restore(serializedState: string): ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
  /**
   * Restores a wallet from a snapshot, reporting what it could not read rather than throwing.
   *
   * @remarks
   *   Additive alongside {@link restore}, which is unchanged and still the right shape for a snapshot the application has
   *   just written itself. This is the shape for one it has not: a snapshot a user supplied, or one written by a build
   *   of the SDK that is no longer the one running, where "I cannot read this" is an ordinary answer rather than a bug.
   *   The two cannot disagree — `restore` is this, with the reason thrown.
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, or the reason the snapshot could not be read. See
   *   {@link UnshieldedRestoreError}.
   */
  tryRestore(
    serializedState: string,
  ): Either.Either<ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>, UnshieldedRestoreError>;
}

/**
 * The same identity, as the pre-fork ledger version has it.
 *
 * @remarks
 *   Unshielded's one genuine version break, and the whole of it. A ledger-v9 verifying key is a `{tag, value}` record
 *   naming a signature scheme; a ledger-v8 one is the bare hex, with no room to name anything, because that ledger
 *   version had exactly one scheme. So a schnorr identity narrows losslessly — dropping a tag whose value was never in
 *   doubt — and the cross-ledger migration widens it back on the way over, which is where its `schnorr` default comes
 *   from.
 *
 *   An ecdsa identity does not narrow at all, and `None` says so rather than dropping the tag and producing a pre-fork
 *   wallet claiming an identity it does not have: an ecdsa key derives a _different_ address, and the migration back
 *   would relabel it `schnorr`, so the round trip is not merely lossy but wrong. The address itself is a scheme-less
 *   hash and is carried, not re-derived, which is why the schnorr narrowing needs no ledger call at all.
 * @param publicKey The identity in the post-fork ledger version's shape.
 * @returns The same identity as the pre-fork ledger version has it, or `None` when that version cannot express it.
 */
export const asPreForkPublicKey = (publicKey: PublicKey): Option.Option<PreForkPublicKey> =>
  publicKey.publicKey.tag === 'schnorr'
    ? Option.some({
        publicKey: publicKey.publicKey.value,
        addressHex: publicKey.addressHex,
        address: publicKey.address,
      })
    : Option.none();

/**
 * Builds an unshielded wallet class over a variant either side of a protocol boundary.
 *
 * @remarks
 *   The boundary is `configuration.forkVersion` and nothing else: the pre-fork variant is registered from the minimum
 *   supported version and the post-fork one from the fork version, so the version at which the runtime hands over and
 *   the version at which each variant stops applying are the same number, taken from one place.
 *
 *   Each variant is built from its own configuration — see {@link SelfConfiguredUnshieldedVariant}.
 * @example
 *   ```typescript
 *   const Wallet = CustomForkingUnshieldedWallet(
 *     { networkId, forkVersion },
 *     { builder: new V1Builder().withDefaults(), configuration: preForkConfiguration },
 *     { builder: new V2Builder().withDefaults().withMigration(...), configuration: postForkConfiguration },
 *   );
 *   const wallet = Wallet.startWithPublicKey(publicKey);
 *   ```;
 *
 * @param configuration What the wallet layer needs: the network, and where the boundary lies.
 * @param preFork The variant that reads the chain below the boundary, with the configuration it is built from.
 * @param postFork The variant that reads it from the boundary, with the configuration it is built from.
 * @returns The wallet class.
 */
export function CustomForkingUnshieldedWallet<
  TPreForkSyncUpdate,
  TPostForkSyncUpdate,
  TPreForkConfig extends object,
  TPostForkConfig extends object,
  TConfiguration extends ForkingUnshieldedConfiguration = ForkingUnshieldedConfiguration,
>(
  configuration: TConfiguration,
  preFork: SelfConfiguredUnshieldedVariant<PreForkUnshieldedVariant<TPreForkSyncUpdate>, TPreForkConfig>,
  postFork: SelfConfiguredUnshieldedVariant<PostForkUnshieldedVariant<TPostForkSyncUpdate>, TPostForkConfig>,
): ForkingUnshieldedWalletClass<TPreForkSyncUpdate, TPostForkSyncUpdate, TConfiguration> {
  type Variants = ForkingUnshieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>;

  // Registered through the shape the builder states rather than through the one this function was handed. The two are
  // the same builder; what is dropped is the configuration *type*, which the parameter types have already paired with
  // its builder — and which, left generic, keeps `build`'s "nothing further is owed" argument list unresolvable.
  const preForkBuilder: VariantBuilder.VariantBuilder<
    PreForkUnshieldedVariant<TPreForkSyncUpdate>,
    object
  > = preFork.builder;
  const postForkBuilder: VariantBuilder.VariantBuilder<
    PostForkUnshieldedVariant<TPostForkSyncUpdate>,
    object
  > = postFork.builder;

  const BaseWallet: WalletLike.BaseWalletClass<Variants> = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, preForkBuilder, preFork.configuration)
    .withVariant(configuration.forkVersion, postForkBuilder, postFork.configuration)
    .build();

  const variants = BaseWallet.allVariantsRecord();

  /**
   * The protocol versions each variant owns, and the version a transaction it builds is stamped with.
   *
   * @remarks
   *   The stamp is the floor of the variant's epoch: every decision it is later read for asks which side of the boundary
   *   the bytes belong to, and the floor answers that the same way as any other version in the same epoch.
   */
  const preForkEpoch = ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, configuration.forkVersion);
  const postForkEpoch = ProtocolVersion.epochOf(configuration.forkVersion, configuration.forkVersion);
  const [preForkStamp] = preForkEpoch;
  const [postForkStamp] = postForkEpoch;

  /** Reads a transaction built before the boundary, refusing one built after it. */
  const preForkTx = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, preForkEpoch));

  /** Reads a transaction built from the boundary, refusing one built before it. */
  const postForkTx = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, postForkEpoch));

  /** Seals a balancing result, which is absent when the wallet had nothing of its own to add. */
  const sealPreFork = (result: v8.UnprovenTransaction | undefined): UnprovenTx | undefined =>
    result === undefined ? undefined : WalletTransaction.adopt('Unproven', result, preForkStamp);

  const sealPostFork = (result: ledger.UnprovenTransaction | undefined): UnprovenTx | undefined =>
    result === undefined ? undefined : WalletTransaction.adopt('Unproven', result, postForkStamp);

  /**
   * Adapts the caller's signer to the pre-fork ledger version's signature shape.
   *
   * @remarks
   *   The SDK's signing callback speaks the current ledger version's signature — a scheme and its bytes — because that is
   *   the shape an application writes against once. What the pre-fork ledger version reads is the bytes alone, and only
   *   of the one scheme it has, so a signer that answers with any other is refused by name here rather than at the WASM
   *   boundary.
   */
  const loweredSigner =
    (signSegment: SignSegment): PreForkSignSegment =>
    (data: Uint8Array) =>
      signSegment(data).then((signature) =>
        Either.getOrThrowWith(PreForkSignatures.lowerSignature(signature), (error) => error),
      );

  /**
   * How long a start waits for the chain to say which version it is on.
   *
   * @remarks
   *   Short, because what is being bought is small: the alternative to an answer is the hand-over this wallet has
   *   always done, which costs one migration and no correctness on a chain that produces messages. It is a ceiling
   *   rather than a typical cost — an unreachable indexer refuses a connection long before this — and it exists so
   *   that a probe which neither answers nor fails cannot hold a start open indefinitely.
   */
  const probeTimeout = Duration.seconds(5);

  /** Where a start begins, when the chain answered for it. */
  type ProbedStart = Readonly<{
    version: ProtocolVersion.ProtocolVersion;
    variant: HList.Each<Variants>;
  }>;

  /**
   * The variant the chain's current version belongs to, or nothing.
   *
   * @remarks
   *   Nothing covers every way the question can fail to produce an answer, and they are deliberately not distinguished:
   *   no probe configured, a probe that rejected, a probe that outlived the wallet's patience, or a version no
   *   registered variant claims. Each means the same thing to a caller — start where a wallet with no history starts —
   *   and none of them is a reason to fail.
   */
  const probedStart: Effect.Effect<Option.Option<ProbedStart>> =
    configuration.chainVersionProbe === undefined
      ? Effect.succeedNone
      : pipe(
          Effect.tryPromise(configuration.chainVersionProbe),
          Effect.timeout(probeTimeout),
          Effect.map((version) =>
            Option.map(BaseWallet.variantFor(version), (variant): ProbedStart => ({ version, variant })),
          ),
          Effect.orElseSucceed(() => Option.none<ProbedStart>()),
        );

  /**
   * A fresh state of the variant a probed start begins at, recording the version the chain reported.
   *
   * @remarks
   *   Built exactly as the head-variant boot path builds its own — the identity, in the shape that variant holds it —
   *   and then annotated with the observed version, which is what keeps a variant from starting outside its own
   *   activation range and signalling backwards on sight.
   * @param variant The variant the chain's version resolved to.
   * @param publicKey The identity in the shape this wallet's API speaks.
   * @param preForkPublicKey The same identity as the pre-fork ledger version has it, which is only reached when that
   *   variant is the one chosen — and only a schnorr identity ever gets here at all.
   */
  const freshStateAt = (
    variant: HList.Each<Variants>,
    publicKey: PublicKey,
    preForkPublicKey: PreForkPublicKey,
    version: ProtocolVersion.ProtocolVersion,
  ): PreForkCoreWallet | CoreWallet =>
    Variant.getVersionedVariantTag(variant) === V2Tag
      ? CoreWallet.withProtocolVersion(CoreWallet.init(publicKey, configuration.networkId), version)
      : PreForkCoreWallet.withProtocolVersion(
          PreForkCoreWallet.init(preForkPublicKey, configuration.networkId),
          version,
        );

  return class ForkingUnshieldedWalletImplementation
    extends BaseWallet
    implements ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>
  {
    static readonly configuration: TConfiguration = configuration;

    static startWithPublicKey(publicKey: PublicKey): Promise<ForkingUnshieldedWalletImplementation> {
      return Option.match(asPreForkPublicKey(publicKey), {
        // The identity both ledger versions can express, so where it begins is a question about the chain rather than
        // about the key: at the variant that owns the version the chain reports, or — when the chain was not asked or
        // did not answer — below the boundary, where a wallet with no history belongs, letting the runtime hand over
        // when the chain says so.
        onSome: (preForkPublicKey) =>
          pipe(
            probedStart,
            Effect.map(
              Option.match({
                onNone: () =>
                  ForkingUnshieldedWalletImplementation.startFirst(
                    ForkingUnshieldedWalletImplementation,
                    PreForkCoreWallet.init(preForkPublicKey, configuration.networkId),
                  ),
                onSome: ({ version, variant }) =>
                  ForkingUnshieldedWalletImplementation.startAtVariant(
                    ForkingUnshieldedWalletImplementation,
                    variant,
                    freshStateAt(variant, publicKey, preForkPublicKey, version),
                  ),
              }),
            ),
            Effect.runPromise,
          ),
        // An identity only the post-fork ledger version can express, so it starts on that variant and stays there —
        // and the chain is not asked, because there is nothing its answer could decide. Stamped with the boundary
        // version rather than left at the minimum: a variant that starts from a state outside its own activation range
        // reports that on sight, which is how a stranded snapshot heals — and here there is no variant above this one
        // to hand over to. The state does belong to this variant, so it says so.
        onNone: () =>
          Promise.resolve(
            ForkingUnshieldedWalletImplementation.startAtVariant(
              ForkingUnshieldedWalletImplementation,
              variants[V2Tag],
              CoreWallet.withProtocolVersion(
                CoreWallet.init(publicKey, configuration.networkId),
                configuration.forkVersion,
              ),
            ),
          ),
      });
    }

    static tryRestore(
      serializedState: string,
    ): Either.Either<ForkingUnshieldedWalletImplementation, UnshieldedRestoreError> {
      const headVariant = HList.head(ForkingUnshieldedWalletImplementation.allVariants());
      return variantForSnapshot(
        serializedState,
        (version) => ForkingUnshieldedWalletImplementation.variantFor(version),
        headVariant,
      ).pipe(
        // Stated with its result type because the resolved variant is either of the two, so its deserializer is
        // either of theirs: what comes back is a state of whichever one wrote the snapshot, which is what
        // `startAtVariant` takes.
        Either.flatMap((variant): Either.Either<ForkingUnshieldedWalletImplementation, UnshieldedRestoreError> => {
          // Annotated rather than inferred because the resolved variant is either of the two, so its deserializer is
          // either of theirs: what comes back is a state of whichever one wrote the snapshot, which is what
          // `startAtVariant` takes.
          const deserialized: Either.Either<PreForkCoreWallet | CoreWallet, UnshieldedRestoreError> =
            variant.variant.deserializeState(serializedState);
          return Either.map(deserialized, (state) =>
            ForkingUnshieldedWalletImplementation.startAtVariant(ForkingUnshieldedWalletImplementation, variant, state),
          );
        }),
      );
    }

    static restore(serializedState: string): ForkingUnshieldedWalletImplementation {
      return Either.getOrThrow(ForkingUnshieldedWalletImplementation.tryRestore(serializedState));
    }

    readonly state: rx.Observable<UnshieldedWalletState<string>>;

    /**
     * Whether the activation watcher has been registered.
     *
     * @remarks
     *   Registration is per wallet, not per `start`: watchers accumulate, so registering on every call would restart sync
     *   once per historical `start` on the next activation. Flipped with `getAndSet` so concurrent `start` calls cannot
     *   both observe it unset.
     */
    readonly #watcherRegistered = Ref.unsafeMake(false);

    /**
     * Whether the wallet is currently started.
     *
     * @remarks
     *   The unshielded counterpart of the retained start material the shielded and dust wallets hold. This wallet is
     *   watch-only — sync needs nothing secret, and signing is supplied per call by the caller — so there is no key to
     *   keep and the restart needs no argument. All the watcher has to know is whether a stopped wallet should be left
     *   stopped, which is what this records; `stop` clears it so a stopped wallet cannot be resurrected by a late
     *   activation.
     */
    readonly #started = Ref.unsafeMake(false);

    constructor(runtime: Runtime.Runtime<Variants>, scope: Scope.CloseableScope) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map((emission) =>
          // The capabilities that understand a state and the state itself are chosen together, in the branch where
          // the producing variant is known. The two variants' capability types are structurally identical, so a
          // capability of one would type-check against a state of the other and be wrong at runtime.
          emission.variantTag === V2Tag
            ? UnshieldedWalletState.fromVariant(variants[V2Tag].variant, emission)
            : UnshieldedWalletState.fromVariant(variants[V1Tag].variant, emission),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    /**
     * Starts background synchronization on whichever variant is current.
     *
     * @remarks
     *   Takes no argument, on either side of the boundary, and that is the shape of the whole wallet: an unshielded
     *   wallet watches an address, and an address is public. A migration therefore strands nothing — the new variant is
     *   simply told to start, exactly as the old one was.
     */
    start(): Promise<void> {
      return Effect.gen(this, function* () {
        yield* Ref.set(this.#started, true);

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V1Tag]: (v1) => this.#resumeSyncOn(v1),
            [V2Tag]: (v2) => this.#resumeSyncOn(v2),
          });
        }

        yield* this.runtime.dispatch({
          [V1Tag]: (v1) => v1.startSyncInBackground(),
          [V2Tag]: (v2) => v2.startSyncInBackground(),
        });
      }).pipe(Effect.runPromise);
    }

    /** Starts synchronization on a variant that has just become current, unless the wallet has been stopped. */
    #resumeSyncOn(running: { startSyncInBackground: () => Effect.Effect<void> }): Effect.Effect<void> {
      return Ref.get(this.#started).pipe(
        // Stopped, or never started: there is nothing to resume.
        Effect.flatMap((started) => (started ? running.startSyncInBackground() : Effect.void)),
      );
    }

    override async stop(): Promise<void> {
      // Cleared before the runtime is torn down, so a stopped wallet cannot be resurrected by an in-flight activation.
      Ref.set(this.#started, false).pipe(Effect.runSync);
      await super.stop();
    }

    balanceFinalizedTransaction(tx: AnyTx): Promise<UnprovenTx | undefined> {
      return this.runtime
        .dispatch<UnprovenTx | undefined, TransactingError>({
          [V1Tag]: (v1) =>
            preForkTx<v8.FinalizedTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v1.balanceFinalizedTransaction(unwrapped)),
              Effect.map(sealPreFork),
            ),
          [V2Tag]: (v2) =>
            postForkTx<ledger.FinalizedTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v2.balanceFinalizedTransaction(unwrapped)),
              Effect.map(sealPostFork),
            ),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * Balances an unbound transaction, which happens in place rather than by producing a second transaction.
     *
     * @returns The transaction with this wallet's inputs added, or nothing when it needed none.
     */
    balanceUnboundTransaction(tx: AnyTx): Promise<UnboundTx | undefined> {
      return this.runtime
        .dispatch<UnboundTx | undefined, TransactingError>({
          [V1Tag]: (v1) =>
            preForkTx<PreForkUnboundTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v1.balanceUnboundTransaction(unwrapped)),
              Effect.map((result) =>
                result === undefined ? undefined : WalletTransaction.adopt('Unbound', result, preForkStamp),
              ),
            ),
          [V2Tag]: (v2) =>
            postForkTx<UnboundTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v2.balanceUnboundTransaction(unwrapped)),
              Effect.map((result) =>
                result === undefined ? undefined : WalletTransaction.adopt('Unbound', result, postForkStamp),
              ),
            ),
        })
        .pipe(Effect.runPromise);
    }

    balanceUnprovenTransaction(tx: AnyTx): Promise<UnprovenTx | undefined> {
      return this.runtime
        .dispatch<UnprovenTx | undefined, TransactingError>({
          [V1Tag]: (v1) =>
            preForkTx<v8.UnprovenTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v1.balanceUnprovenTransaction(unwrapped)),
              Effect.map(sealPreFork),
            ),
          [V2Tag]: (v2) =>
            postForkTx<ledger.UnprovenTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v2.balanceUnprovenTransaction(unwrapped)),
              Effect.map(sealPostFork),
            ),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            v1
              .transferTransaction(outputs, ttl)
              .pipe(Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp))),
          [V2Tag]: (v2) =>
            v2
              .transferTransaction(outputs, ttl)
              .pipe(Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp))),
        })
        .pipe(Effect.runPromise);
    }

    rotateUtxos(
      guaranteedUtxos: readonly UtxoWithMeta[],
      fallibleUtxos: readonly UtxoWithMeta[],
      nightVerifyingKey: ledger.SignatureVerifyingKey,
      ttl: Date,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            EitherOps.toEffect(PreForkSignatures.lowerSignatureVerifyingKey(nightVerifyingKey)).pipe(
              Effect.flatMap((key) => v1.rotateUtxos(guaranteedUtxos, fallibleUtxos, key, ttl)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            v2
              .rotateUtxos(guaranteedUtxos, fallibleUtxos, nightVerifyingKey, ttl)
              .pipe(Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp))),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
      ttl: Date,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            v1
              .initSwap(desiredInputs, desiredOutputs, ttl)
              .pipe(Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp))),
          [V2Tag]: (v2) =>
            v2
              .initSwap(desiredInputs, desiredOutputs, ttl)
              .pipe(Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp))),
        })
        .pipe(Effect.runPromise);
    }

    signUnprovenTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            preForkTx<v8.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((unwrapped) => v1.signUnprovenTransaction(unwrapped, loweredSigner(signSegment))),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            postForkTx<ledger.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((unwrapped) => v2.signUnprovenTransaction(unwrapped, signSegment)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    signUnboundTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnboundTx> {
      return this.runtime
        .dispatch<UnboundTx, TransactingError>({
          [V1Tag]: (v1) =>
            preForkTx<PreForkUnboundTransaction>(transaction).pipe(
              Effect.flatMap((unwrapped) => v1.signUnboundTransaction(unwrapped, loweredSigner(signSegment))),
              Effect.map((tx) => WalletTransaction.adopt('Unbound', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            postForkTx<UnboundTransaction>(transaction).pipe(
              Effect.flatMap((unwrapped) => v2.signUnboundTransaction(unwrapped, signSegment)),
              Effect.map((tx) => WalletTransaction.adopt('Unbound', tx, postForkStamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * Un-books the UTxOs a transaction of this wallet's had reserved, returning them to the available set.
     *
     * @remarks
     *   A transaction built on the other side of the boundary cannot have booked any of this variant's UTxOs, so there is
     *   nothing to release and this resolves having done nothing. That is the one place a version mismatch is not an
     *   error: the facade reverts all three wallets together when a submission fails, and a refusal here would strand
     *   that whole path over a transaction this wallet was never holding anything for.
     * @param transaction The transaction to un-book.
     */
    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch<void, WalletError>({
          [V1Tag]: (v1) =>
            Either.match(
              WalletTransaction.unwrapWithin<v8.Transaction<v8.SignatureEnabled, v8.Proofish, v8.Bindingish>>(
                transaction,
                preForkEpoch,
              ),
              { onLeft: () => Effect.void, onRight: (unwrapped) => v1.revertTransaction(unwrapped) },
            ),
          [V2Tag]: (v2) =>
            Either.match(
              WalletTransaction.unwrapWithin<
                ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
              >(transaction, postForkEpoch),
              { onLeft: () => Effect.void, onRight: (unwrapped) => v2.revertTransaction(unwrapped) },
            ),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<UnshieldedWalletState<string>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state. It's preferable to use [[UnshieldedWalletState.serialize]] instead, to know
     * exactly which state is serialized.
     */
    serializeState(): Promise<string> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<UnshieldedAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}

/** An unshielded wallet built the way this package ships it: one variant either side of the protocol boundary. */
export type UnshieldedWallet = ForkingUnshieldedWallet<PreForkSyncUpdate, PostForkSyncUpdate>;

/** The class {@link UnshieldedWallet} builds. */
export type UnshieldedWalletClass = ForkingUnshieldedWalletClass<
  PreForkSyncUpdate,
  PostForkSyncUpdate,
  DefaultUnshieldedConfiguration
>;

/**
 * Builds the unshielded wallet this package ships: the default variant either side of `configuration.forkVersion`.
 *
 * @remarks
 *   Both variants read the chain through the indexer's unshielded-transaction subscription and record transaction history
 *   in the same storage, and both are built from the same application configuration, because what they ask for is
 *   identical — unshielded sync carries no ledger object in either direction, only public UTXO records as JSON.
 *
 *   Transacting, synchronization, balances, coins, addresses, serialization, restore and reverting all work on both
 *   sides: each variant builds with its own ledger version, and what it produces says which version built it.
 *
 *   **The chain is asked where it is before a variant is chosen.** The indexer this wallet already syncs from answers
 *   which protocol version the chain is on, so a start on a chain past the boundary begins post-fork rather than
 *   handing over immediately. An application that would rather ask something else — a cache, a value it already holds
 *   — supplies its own `chainVersionProbe`; one whose chain cannot be reached loses nothing, because the answer is
 *   best-effort and its absence is the behaviour this wallet had before.
 * @param configuration What the wallet and both its variants are built from, including where the boundary lies.
 * @returns The wallet class.
 */
export function UnshieldedWallet(configuration: DefaultUnshieldedConfiguration): UnshieldedWalletClass {
  const withProbe: DefaultUnshieldedConfiguration = {
    ...configuration,
    chainVersionProbe: configuration.chainVersionProbe ?? makeIndexerChainVersionProbe(configuration),
  };
  return CustomForkingUnshieldedWallet(
    withProbe,
    { builder: new V1Builder().withDefaults(), configuration },
    {
      builder: new V2Builder().withDefaults().withMigration(() => Migration.makeCrossLedgerMigration()),
      configuration,
    },
  );
}
