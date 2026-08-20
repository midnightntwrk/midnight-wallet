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
 * A shielded wallet that registers a variant either side of a protocol boundary and follows the chain across it.
 *
 * @remarks
 *   One wallet, two ledger versions. Before the boundary the pre-fork variant reads the chain with the ledger version
 *   that produced it; from the boundary the post-fork variant does, having been handed identity and a place in the
 *   timeline and nothing else. Which one is running is the runtime's business, not the application's: the wallet's
 *   public API speaks the post-fork ledger version throughout, and where the two sides genuinely differ — the key
 *   material each variant's synchronization needs — the wallet resolves it per variant from what it retained.
 */
import type * as v8 from '@midnight-ntwrk/ledger-v8';
import type * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  type NetworkId,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnprovenTx,
  WalletSeed,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ShieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  type ChainVersionProbe,
  makeIndexerChainVersionProbe,
} from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import {
  StartMaterial,
  Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps, HList } from '@midnightntwrk/wallet-sdk-utilities';
import { Duration, Effect, Either, Option, Ref, type Scope, pipe } from 'effect';
import * as rx from 'rxjs';
import { type UnsupportedSnapshotVersionError, variantForSnapshot } from './Restore.js';
import {
  type DefaultShieldedConfiguration,
  type ShieldedBalancingResult,
  ShieldedWalletState,
  type ShieldedWalletAPI,
} from './ShieldedWallet.js';
import { CoreWallet as PreForkCoreWallet, V1Builder, V1Tag, type V1Variant } from './v1/index.js';
import { type WalletSyncUpdate as PreForkSyncUpdate } from './v1/Sync.js';
import { CoreWallet, Migration, V2Builder, V2Tag, type V2Variant } from './v2/index.js';
import { type WalletSyncUpdate as PostForkSyncUpdate } from './v2/Sync.js';
import { type TokenTransfer } from './v2/Transacting.js';
import { type WalletError as PreForkWalletError } from './v1/WalletError.js';
import { type WalletError } from './v2/WalletError.js';

/**
 * What restoring a shielded wallet from a snapshot can fail with.
 *
 * @remarks
 *   Two failures, and they mean different things. The snapshot may declare a protocol version no registered variant
 *   reads, which is a fact about this build of the SDK rather than about the snapshot; or the variant that owns it may
 *   be unable to make sense of the bytes, which is a fact about the snapshot. Either is an ordinary thing to meet when
 *   restoring something a user supplied, which is why `tryRestore` reports them rather than throwing.
 */
export type ShieldedRestoreError = UnsupportedSnapshotVersionError | PreForkWalletError | WalletError;

/**
 * What a transacting call can fail with.
 *
 * @remarks
 *   Two failures beyond the variant's own: the wallet may hold no key material the current variant can use — which is
 *   what a wallet started from post-fork key objects has to say while it is still pre-fork — and a transaction handed
 *   in may have been built on the other side of the boundary, which no variant here can read.
 */
type TransactingError = WalletError | StartMaterial.MissingStartAuxError | ProtocolVersionMismatchError;

/** The pre-fork variant a forking shielded wallet registers: the one that reads the chain before the boundary. */
export type PreForkShieldedVariant<TSyncUpdate> = V1Variant<
  string,
  TSyncUpdate,
  v8.FinalizedTransaction,
  v8.ZswapSecretKeys
>;

/** The post-fork variant a forking shielded wallet registers: the one the pre-fork wallet is migrated into. */
export type PostForkShieldedVariant<TSyncUpdate> = V2Variant<
  string,
  TSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.ZswapSecretKeys,
  Migration.PreviousLedgerWallet
>;

/** The two variants a forking shielded wallet runs, in registration order. */
export type ForkingShieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate> = [
  Variant.VersionedVariant<PreForkShieldedVariant<TPreForkSyncUpdate>>,
  Variant.VersionedVariant<PostForkShieldedVariant<TPostForkSyncUpdate>>,
];

/**
 * A variant builder registered together with the configuration it alone is built from.
 *
 * @remarks
 *   Per-variant rather than shared, because two variants either side of a protocol boundary can mean different and
 *   mutually unassignable things by the same configuration key — a `simulator` or an indexer connection belonging to
 *   one ledger version or the other. A wallet-wide intersection of those is a configuration no single variant can
 *   consume.
 */
export type SelfConfiguredShieldedVariant<
  TVariant extends Variant.AnyVariant,
  TConfiguration extends object,
> = Readonly<{
  builder: VariantBuilder.VariantBuilder<TVariant, TConfiguration>;
  configuration: TConfiguration;
}>;

/** What a forking shielded wallet needs to know about itself, whatever its variants are built from. */
export type ForkingShieldedConfiguration = {
  networkId: NetworkId.NetworkId;
  /** The protocol version at which the chain hands over from the pre-fork ledger version to the post-fork one. */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /**
   * How the wallet asks the chain which protocol version it is on, before it chooses a variant to start at.
   *
   * @remarks
   *   Optional, and best-effort where present: a wallet with no probe — or one whose probe does not answer in time —
   *   starts on the pre-fork variant and learns the version from the first event it sees, which is what a wallet with
   *   no history has always done. What a probe buys is the two things that guess costs: a hand-over per start on a
   *   chain entirely past the boundary, and, on a chain that has shown this wallet no events at all, an epoch that
   *   never gets corrected.
   *
   *   Nothing about it can make a start fail. A rejection, a timeout, a version no registered variant covers: each leaves
   *   the wallet exactly where a wallet that never asked would be.
   */
  chainVersionProbe?: ChainVersionProbe;
};

/**
 * One ledger version's shielded key objects per side of a protocol boundary.
 *
 * @remarks
 *   Both sides are required. A caller holding key objects rather than a seed has to hold both, because the two belong to
 *   different ledger runtimes and neither can be derived from the other; a product with one side optional would let a
 *   wallet be built that cannot read half the chain, which is the shape this replaced.
 */
export type ShieldedKeysByEpoch = Readonly<{
  /** The pre-fork ledger version's Zswap secret keys. */
  v8: v8.ZswapSecretKeys;
  /** The post-fork ledger version's Zswap secret keys. */
  v9: ledger.ZswapSecretKeys;
}>;

/** A running shielded wallet that spans a protocol boundary. */
export type ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate> = ShieldedWalletAPI<
  ledger.ZswapSecretKeys,
  ledger.FinalizedTransaction,
  string
> &
  WalletLike.WalletLike<ForkingShieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>>;

/** The class a forking shielded wallet is started from. */
export interface ForkingShieldedWalletClass<
  TPreForkSyncUpdate,
  TPostForkSyncUpdate,
  TConfiguration extends ForkingShieldedConfiguration = ForkingShieldedConfiguration,
> extends WalletLike.BaseWalletClass<ForkingShieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>, TConfiguration> {
  /**
   * Builds a wallet from a seed, and remembers the seed.
   *
   * @remarks
   *   The only start that can follow the chain the whole way. The seed is the one piece of key material that crosses a
   *   protocol boundary — each variant derives its own from it — so a wallet built this way can synchronize on either
   *   side of the fork.
   *
   *   Asynchronous because choosing where to begin can mean asking the chain: with a
   *   {@link ForkingShieldedConfiguration.chainVersionProbe} configured, the wallet starts at the variant that owns the
   *   version the chain reports, which on a chain already past the boundary is the post-fork one from the first moment.
   *   Without one, or when the question goes unanswered, it begins on the pre-fork variant and is handed over when the
   *   chain reports a version the post-fork variant owns — on a chain that has already forked, the first batch it
   *   sees.
   * @param seed The seed to derive both ledger versions' keys from.
   * @returns A wallet started at the variant the chain is on, or on the pre-fork variant when the chain was not asked
   *   or did not say.
   */
  startWithSeed(seed: Uint8Array): Promise<ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>>;
  /**
   * Builds a wallet from key objects of both ledger versions.
   *
   * @remarks
   *   The escape hatch for a caller that will not hand over a seed. Both sides are required, and that is the whole point:
   *   key objects belong to one ledger version's runtime, so a wallet given one side alone could not read the other
   *   side of the chain — and a partial product here would be exactly the foot-gun the single-key start was. It costs
   *   the caller an import of both ledger packages and the same derivation done twice; a seed costs neither.
   * @param keys One ledger version's Zswap secret keys per side of the boundary.
   * @returns A wallet started at the variant the chain is on, or on the pre-fork variant — where a wallet with no
   *   history belongs — when the chain was not asked or did not say.
   */
  startWithKeys(keys: ShieldedKeysByEpoch): Promise<ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>>;
  /**
   * Restores a wallet from a snapshot, into whichever registered variant wrote it.
   *
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, on the variant that owns its protocol version.
   * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
   */
  restore(serializedState: string): ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
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
   *   {@link ShieldedRestoreError}.
   */
  tryRestore(
    serializedState: string,
  ): Either.Either<ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>, ShieldedRestoreError>;
}

/**
 * Builds a shielded wallet class over a variant either side of a protocol boundary.
 *
 * @remarks
 *   The boundary is `configuration.forkVersion` and nothing else: the pre-fork variant is registered from the minimum
 *   supported version and the post-fork one from the fork version, so the version at which the runtime hands over and
 *   the version at which each variant stops applying are the same number, taken from one place.
 *
 *   Each variant is built from its own configuration. What the wallet layer needs — the network it is on and where the
 *   boundary lies — it takes separately, because neither variant knows there is another one.
 * @example
 *   ```typescript
 *   const Wallet = CustomForkingShieldedWallet(
 *     { networkId, forkVersion },
 *     { builder: new V1Builder().withDefaults(), configuration: preForkConfiguration },
 *     { builder: new V2Builder().withDefaults().withMigration(makeCrossLedgerMigration), configuration: postForkConfiguration },
 *   );
 *   const wallet = Wallet.startWithSeed(seed);
 *   ```;
 *
 * @param configuration What the wallet layer needs: the network, and where the boundary lies.
 * @param preFork The variant that reads the chain below the boundary, with the configuration it is built from.
 * @param postFork The variant that reads it from the boundary, with the configuration it is built from.
 * @returns The wallet class.
 */
export function CustomForkingShieldedWallet<
  TPreForkSyncUpdate,
  TPostForkSyncUpdate,
  TPreForkConfig extends object,
  TPostForkConfig extends object,
  TConfiguration extends ForkingShieldedConfiguration = ForkingShieldedConfiguration,
>(
  configuration: TConfiguration,
  preFork: SelfConfiguredShieldedVariant<PreForkShieldedVariant<TPreForkSyncUpdate>, TPreForkConfig>,
  postFork: SelfConfiguredShieldedVariant<PostForkShieldedVariant<TPostForkSyncUpdate>, TPostForkConfig>,
): ForkingShieldedWalletClass<TPreForkSyncUpdate, TPostForkSyncUpdate, TConfiguration> {
  type Variants = ForkingShieldedVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>;

  // Registered through the shape the builder states rather than through the one this function was handed. The two are
  // the same builder; what is dropped is the configuration *type*, which the parameter types have already paired with
  // its builder — and which, left generic, keeps `build`'s "nothing further is owed" argument list unresolvable.
  const preForkBuilder: VariantBuilder.VariantBuilder<
    PreForkShieldedVariant<TPreForkSyncUpdate>,
    object
  > = preFork.builder;
  const postForkBuilder: VariantBuilder.VariantBuilder<
    PostForkShieldedVariant<TPostForkSyncUpdate>,
    object
  > = postFork.builder;

  const BaseWallet: WalletLike.BaseWalletClass<Variants> = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, preForkBuilder, preFork.configuration)
    .withVariant(configuration.forkVersion, postForkBuilder, postFork.configuration)
    .build();

  const variants = BaseWallet.allVariantsRecord();

  /**
   * The key material this wallet holds, one entry per side of the protocol boundary.
   *
   * @remarks
   *   Key objects belong to one ledger version's runtime and cannot be converted, so "the keys this wallet holds" is two
   *   questions, not one, and the type says so: each side is present or it is not, independently. A wallet that holds
   *   only the post-fork side cannot read a chain that is still pre-fork, and finds that out here rather than by
   *   handing over keys the other runtime would misread.
   *
   *   A seed is not among them. A seed can produce either side, so a wallet given one derives both at once and keeps the
   *   results — which is the same capability with a shorter-lived secret, since from that moment the seed is not this
   *   wallet's to hold.
   */
  type RetainedKeys = Readonly<{
    preFork: Option.Option<v8.ZswapSecretKeys>;
    postFork: Option.Option<ledger.ZswapSecretKeys>;
  }>;

  /** Nothing retained: never started, or stopped. */
  const noKeys: RetainedKeys = { preFork: Option.none(), postFork: Option.none() };

  /** Both sides, derived from one seed. */
  const keysFromSeed = (seed: WalletSeed.WalletSeed): RetainedKeys => ({
    preFork: Option.some(variants[V1Tag].variant.startAux.fromSeed(seed)),
    postFork: Option.some(variants[V2Tag].variant.startAux.fromSeed(seed)),
  });

  /**
   * What a variant can be started with, or why it cannot be.
   *
   * @remarks
   *   Two different failures, deliberately distinguished: a wallet that was never started (or has been stopped) holds
   *   nothing at all, while one started with the other side's key objects holds something it must not use here.
   */
  const auxFor = <TAux>(
    retained: RetainedKeys,
    side: Option.Option<TAux>,
    variantTag: symbol,
  ): Either.Either<TAux, StartMaterial.MissingStartAuxError> =>
    Either.fromOption(
      side,
      () =>
        new StartMaterial.MissingStartAuxError({
          message:
            Option.isNone(retained.preFork) && Option.isNone(retained.postFork)
              ? `This wallet holds no key material: it has not been started, or it has been stopped. Start it ` +
                `before asking it to synchronize or to build a transaction.`
              : `This wallet was started with key material of the other protocol version, which the variant ` +
                `${String(variantTag)} cannot use: key objects belong to one ledger version's runtime. Start it from ` +
                `a seed, or hand it both versions' keys.`,
          variantTag,
        }),
    );

  const preForkAux = (retained: RetainedKeys): Either.Either<v8.ZswapSecretKeys, StartMaterial.MissingStartAuxError> =>
    auxFor(retained, retained.preFork, V1Tag);

  const postForkAux = (
    retained: RetainedKeys,
  ): Either.Either<ledger.ZswapSecretKeys, StartMaterial.MissingStartAuxError> =>
    auxFor(retained, retained.postFork, V2Tag);

  /**
   * The protocol versions each variant owns, and the version a transaction it builds is stamped with.
   *
   * @remarks
   *   The stamp is the version at which the variant that built the transaction became current — the floor of its epoch —
   *   rather than the block height the chain happened to be at. Every decision the stamp is later read for asks which
   *   side of the boundary the bytes belong to: which prover proves them, which validator checks them, which variant
   *   may unwrap them. The epoch floor is the one value guaranteed to answer that the same way as any other version in
   *   the same epoch, and it is derived here from the same `forkVersion` the variants are registered at.
   */
  const preForkEpoch = ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, configuration.forkVersion);
  const postForkEpoch = ProtocolVersion.epochOf(configuration.forkVersion, configuration.forkVersion);
  const [preForkStamp] = preForkEpoch;
  const [postForkStamp] = postForkEpoch;

  /** Seals a balancing result, which is absent when the wallet had nothing of its own to add. */
  const sealPreFork = (result: v8.UnprovenTransaction | undefined): ShieldedBalancingResult =>
    result === undefined ? undefined : WalletTransaction.adopt('Unproven', result, preForkStamp);

  const sealPostFork = (result: ledger.UnprovenTransaction | undefined): ShieldedBalancingResult =>
    result === undefined ? undefined : WalletTransaction.adopt('Unproven', result, postForkStamp);

  /**
   * How long a start waits for the chain to say which version it is on.
   *
   * @remarks
   *   Short, because what is being bought is small: the alternative to an answer is the hand-over this wallet has always
   *   done, which costs one migration and no correctness on a chain that produces events. It is a ceiling rather than a
   *   typical cost — an unreachable indexer refuses a connection long before this — and it exists so that a probe which
   *   neither answers nor fails cannot hold a start open indefinitely.
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
   *   Built exactly as the head-variant boot path builds its own — an empty state of that variant, from that ledger
   *   version's keys — and then annotated with the observed version, which is what keeps a variant from starting
   *   outside its own activation range and signalling backwards on sight.
   */
  const freshStateAt = (
    variant: HList.Each<Variants>,
    keys: ShieldedKeysByEpoch,
    version: ProtocolVersion.ProtocolVersion,
  ): PreForkCoreWallet | CoreWallet =>
    Variant.getVersionedVariantTag(variant) === V2Tag
      ? CoreWallet.withProtocolVersion(CoreWallet.initEmpty(keys.v9, configuration.networkId), version)
      : PreForkCoreWallet.withProtocolVersion(PreForkCoreWallet.initEmpty(keys.v8, configuration.networkId), version);

  return class ForkingShieldedWalletImplementation
    extends BaseWallet
    implements ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>
  {
    static readonly configuration: TConfiguration = configuration;

    /**
     * Starts at the variant the chain says it is on, or at the head variant when it does not say.
     *
     * @remarks
     *   The second branch is the whole of this wallet's previous behaviour, unchanged and reached whenever the chain was
     *   not asked or did not answer: the pre-fork variant, an empty state, and a hand-over on the first batch that
     *   reports a version it does not own.
     * @param keys One ledger version's keys per side of the boundary, since either side may be the one that runs.
     * @returns The started wallet.
     */
    static #startProbed(keys: ShieldedKeysByEpoch): Promise<ForkingShieldedWalletImplementation> {
      return pipe(
        probedStart,
        Effect.map(
          Option.match({
            onNone: () =>
              ForkingShieldedWalletImplementation.startFirst(
                ForkingShieldedWalletImplementation,
                PreForkCoreWallet.initEmpty(keys.v8, configuration.networkId),
              ),
            onSome: ({ version, variant }) =>
              ForkingShieldedWalletImplementation.startAtVariant(
                ForkingShieldedWalletImplementation,
                variant,
                freshStateAt(variant, keys, version),
              ),
          }),
        ),
        Effect.runPromise,
      );
    }

    static async startWithSeed(seed: Uint8Array): Promise<ForkingShieldedWalletImplementation> {
      const derived = keysFromSeed(WalletSeed.WalletSeed(seed));
      const wallet = await ForkingShieldedWalletImplementation.#startProbed({
        v8: Option.getOrThrow(derived.preFork),
        v9: Option.getOrThrow(derived.postFork),
      });
      // Both sides derived here and now, and the seed reference dropped with this frame: from this point the wallet
      // holds key objects only, which is strictly less than it held before and does the same work.
      wallet.#retainKeys(derived);
      return wallet;
    }

    static async startWithKeys(keys: ShieldedKeysByEpoch): Promise<ForkingShieldedWalletImplementation> {
      const wallet = await ForkingShieldedWalletImplementation.#startProbed(keys);
      wallet.#retainKeys({ preFork: Option.some(keys.v8), postFork: Option.some(keys.v9) });
      return wallet;
    }

    static tryRestore(
      serializedState: string,
    ): Either.Either<ForkingShieldedWalletImplementation, ShieldedRestoreError> {
      const headVariant = HList.head(ForkingShieldedWalletImplementation.allVariants());
      return variantForSnapshot(
        serializedState,
        (version) => ForkingShieldedWalletImplementation.variantFor(version),
        headVariant,
      ).pipe(
        // Stated with its result type because the resolved variant is either of the two, so its deserializer is
        // either of theirs: what comes back is a state of whichever one wrote the snapshot, which is what
        // `startAtVariant` takes.
        Either.flatMap((variant): Either.Either<ForkingShieldedWalletImplementation, ShieldedRestoreError> => {
          // Annotated rather than inferred because the resolved variant is either of the two, so its deserializer is
          // either of theirs: what comes back is a state of whichever one wrote the snapshot, which is what
          // `startAtVariant` takes.
          const deserialized: Either.Either<PreForkCoreWallet | CoreWallet, ShieldedRestoreError> =
            variant.variant.deserializeState(serializedState);
          return Either.map(deserialized, (state) =>
            ForkingShieldedWalletImplementation.startAtVariant(ForkingShieldedWalletImplementation, variant, state),
          );
        }),
      );
    }

    static restore(serializedState: string): ForkingShieldedWalletImplementation {
      return Either.getOrThrow(ForkingShieldedWalletImplementation.tryRestore(serializedState));
    }

    readonly state: rx.Observable<ShieldedWalletState<string>>;

    /**
     * What the application started this wallet with, kept so synchronization can be started again.
     *
     * @remarks
     *   A migration starts a fresh variant whose sync has never run, and sync needs key material that is deliberately
     *   absent from anything the wallet serializes. A retained seed answers for both variants; retained key objects
     *   answer only for the post-fork one, which is the ledger version this wallet's public API speaks. Cleared by
     *   {@link stop} so a stopped wallet cannot be resurrected by a late activation.
     */
    readonly #retainedKeys = Ref.unsafeMake<RetainedKeys>(noKeys);

    /** Remembers key material for both sides of the boundary. */
    #retainKeys(keys: RetainedKeys): void {
      Ref.set(this.#retainedKeys, keys).pipe(Effect.runSync);
    }

    /**
     * Starts synchronization on a variant that has just become current, with key material it can use.
     *
     * @param running The variant to start.
     * @param auxFor That variant's own resolution of what it can be started with.
     */
    #resumeSyncOn<TStartAux>(
      running: { startSyncInBackground: (aux: TStartAux) => Effect.Effect<void> },
      keysFor: (retained: RetainedKeys) => Either.Either<TStartAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<void, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedKeys).pipe(
        Effect.flatMap((retained) =>
          // Stopped, or never started: there is nothing to resume and nothing to resume it with.
          Option.isNone(retained.preFork) && Option.isNone(retained.postFork)
            ? Effect.void
            : EitherOps.toEffect(keysFor(retained)).pipe(Effect.flatMap((aux) => running.startSyncInBackground(aux))),
        ),
      );
    }

    /**
     * Whether the activation watcher has been registered.
     *
     * @remarks
     *   Registration is per wallet, not per `start`: watchers accumulate, so registering on every call would restart sync
     *   once per historical `start` on the next activation. Flipped with `getAndSet` so concurrent `start` calls cannot
     *   both observe it unset.
     */
    readonly #watcherRegistered = Ref.unsafeMake(false);

    constructor(runtime: Runtime.Runtime<Variants>, scope: Scope.CloseableScope) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map((emission) =>
          // The capabilities that understand a state and the state itself are chosen together, in the branch where
          // the producing variant is known. The two variants' capability types are structurally identical, so a
          // capability of one would type-check against a state of the other and be wrong at runtime.
          emission.variantTag === V2Tag
            ? ShieldedWalletState.fromVariant(variants[V2Tag].variant, emission)
            : ShieldedWalletState.fromVariant(variants[V1Tag].variant, emission),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    /**
     * Starts background synchronization on whichever variant is current, and keeps the keys for the next one.
     *
     * @remarks
     *   The keys are the post-fork ledger version's, so they are retained against that variant alone. A wallet still on
     *   the pre-fork variant is started from what it retained instead — which a wallet built from a seed can always
     *   answer, and a wallet built from key objects cannot.
     * @param secretKeys The post-fork ledger version's Zswap secret keys.
     */
    start(secretKeys: ledger.ZswapSecretKeys): Promise<void> {
      return Effect.gen(this, function* () {
        // The post-fork side only: these keys belong to that ledger version's runtime. Whatever the wallet already
        // holds for the pre-fork side is left as it is, so a wallet built from a seed keeps the ability to read a
        // chain that has not forked yet.
        yield* Ref.update(this.#retainedKeys, (retained) => ({ ...retained, postFork: Option.some(secretKeys) }));

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V1Tag]: (v1) => this.#resumeSyncOn(v1, preForkAux),
            [V2Tag]: (v2) => this.#resumeSyncOn(v2, postForkAux),
          });
        }

        yield* this.runtime.dispatch({
          [V1Tag]: (v1) => this.#resumeSyncOn(v1, preForkAux),
          [V2Tag]: (v2) => v2.startSyncInBackground(secretKeys),
        });
      }).pipe(Effect.runPromise);
    }

    async stop(): Promise<void> {
      // Released before the runtime is torn down: the key material outlives neither the wallet nor an in-flight
      // activation.
      Ref.set(this.#retainedKeys, noKeys).pipe(Effect.runSync);
      await super.stop();
    }

    /**
     * The key material the variant that is current can use, from what this wallet retained.
     *
     * @remarks
     *   Transacting needs the same secrets synchronization does, and for the same reason: coin selection reads coins only
     *   their owner can decrypt. A wallet that was never started, or one holding key objects of the other ledger
     *   version, has none the current variant can use and says so by name.
     */
    #requireAux<TAux>(
      keysFor: (retained: RetainedKeys) => Either.Either<TAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<TAux, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedKeys).pipe(Effect.flatMap((retained) => EitherOps.toEffect(keysFor(retained))));
    }

    /**
     * Balances a transaction with shielded coins, on whichever side of the boundary it was built.
     *
     * @param tx The transaction to balance, which must have been built in the epoch this wallet is currently in.
     * @returns The balancing transaction, stamped with the version it was built at, or nothing when none is needed.
     */
    balanceTransaction(tx: AnyTx): Promise<ShieldedBalancingResult> {
      return this.runtime
        .dispatch<ShieldedBalancingResult, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              this.#requireAux(preForkAux),
              EitherOps.toEffect(
                WalletTransaction.unwrapWithin<v8.Transaction<v8.Signaturish, v8.Proofish, v8.Bindingish>>(
                  tx,
                  preForkEpoch,
                ),
              ),
            ]).pipe(
              Effect.flatMap(([keys, unwrapped]) => v1.balanceTransaction(keys, unwrapped)),
              Effect.map(sealPreFork),
            ),
          [V2Tag]: (v2) =>
            Effect.all([
              this.#requireAux(postForkAux),
              EitherOps.toEffect(
                WalletTransaction.unwrapWithin<
                  ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>
                >(tx, postForkEpoch),
              ),
            ]).pipe(
              Effect.flatMap(([keys, unwrapped]) => v2.balanceTransaction(keys, unwrapped)),
              Effect.map(sealPostFork),
            ),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[]): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            this.#requireAux(preForkAux).pipe(
              Effect.flatMap((keys) => v1.transferTransaction(keys, outputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            this.#requireAux(postForkAux).pipe(
              Effect.flatMap((keys) => v2.transferTransaction(keys, outputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            this.#requireAux(preForkAux).pipe(
              Effect.flatMap((keys) => v1.initSwap(keys, desiredInputs, desiredOutputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            this.#requireAux(postForkAux).pipe(
              Effect.flatMap((keys) => v2.initSwap(keys, desiredInputs, desiredOutputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * Un-records a transaction this wallet produced, releasing the coins it had booked.
     *
     * @remarks
     *   A transaction built on the other side of the boundary is not one the current variant could have booked coins for,
     *   so there is nothing of it to release and this resolves having done nothing. That is the one place a version
     *   mismatch is not an error: the facade reverts all three wallets together when a submission fails, and a refusal
     *   here would strand that whole path over a transaction this wallet was never holding anything for.
     * @param transaction The transaction to un-record.
     */
    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch<void, TransactingError>({
          [V1Tag]: (v1) =>
            Either.match(
              WalletTransaction.unwrapWithin<v8.Transaction<v8.Signaturish, v8.Proofish, v8.Bindingish>>(
                transaction,
                preForkEpoch,
              ),
              { onLeft: () => Effect.void, onRight: (unwrapped) => v1.revertTransaction(unwrapped) },
            ),
          [V2Tag]: (v2) =>
            Either.match(
              WalletTransaction.unwrapWithin<
                ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>
              >(transaction, postForkEpoch),
              { onLeft: () => Effect.void, onRight: (unwrapped) => v2.revertTransaction(unwrapped) },
            ),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<ShieldedWalletState<string>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state. It's preferable to use [[ShieldedWalletState.serialize]] instead, to know
     * exactly which state is serialized.
     */
    serializeState(): Promise<string> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<ShieldedAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}

/** A shielded wallet built the way this package ships it: one variant either side of the protocol boundary. */
export type ShieldedWallet = ForkingShieldedWallet<PreForkSyncUpdate, PostForkSyncUpdate>;

/** The class {@link ShieldedWallet} builds. */
export type ShieldedWalletClass = ForkingShieldedWalletClass<
  PreForkSyncUpdate,
  PostForkSyncUpdate,
  DefaultShieldedConfiguration
>;

/**
 * Builds the shielded wallet this package ships: the default variant either side of `configuration.forkVersion`.
 *
 * @remarks
 *   Both variants read the chain through the indexer and record transaction history in the same storage; each is built
 *   from the same application configuration, because what they ask for happens to coincide. The post-fork variant is
 *   registered with the cross-ledger migration, which is what makes the hand-over carry identity and a cursor onto a
 *   fresh state rather than start a wallet from nothing.
 *
 *   **Transacting works on either side of the boundary**: the active variant builds with its own ledger and its own
 *   derived keys, and every result travels as a handle stamped with the epoch that built it. Proving a pre-fork
 *   transaction still requires a proving server registered below the boundary.
 *
 *   **The chain is asked where it is before a variant is chosen.** The indexer this wallet already syncs from answers
 *   which protocol version the chain is on, so a start on a chain past the boundary begins post-fork rather than
 *   handing over immediately. An application that would rather ask something else — a cache, a value it already holds —
 *   supplies its own `chainVersionProbe`; one whose chain cannot be reached loses nothing, because the answer is
 *   best-effort and its absence is the behaviour this wallet had before.
 * @param configuration What the wallet and both its variants are built from, including where the boundary lies.
 * @returns The wallet class.
 */
export function ShieldedWallet(configuration: DefaultShieldedConfiguration): ShieldedWalletClass {
  const withProbe: DefaultShieldedConfiguration = {
    ...configuration,
    chainVersionProbe: configuration.chainVersionProbe ?? makeIndexerChainVersionProbe(configuration),
  };
  return CustomForkingShieldedWallet(
    withProbe,
    { builder: new V1Builder().withDefaults(), configuration },
    {
      builder: new V2Builder().withDefaults().withMigration(() => Migration.makeCrossLedgerMigration()),
      configuration,
    },
  );
}
