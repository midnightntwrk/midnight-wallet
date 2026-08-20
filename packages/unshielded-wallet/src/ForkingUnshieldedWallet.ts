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
import type * as ledger from '@midnightntwrk/ledger-v9';
import { type NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { type Variant, type VariantBuilder, type WalletLike } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { HList } from '@midnightntwrk/wallet-sdk-utilities';
import { Data, Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type PublicKey } from './KeyStore.js';
import { variantForSnapshot } from './Restore.js';
import {
  type DefaultUnshieldedConfiguration,
  type UnshieldedWalletAPI,
  UnshieldedWalletState,
} from './UnshieldedWallet.js';
import { CoreWallet as PreForkCoreWallet, V1Builder, V1Tag, type V1Variant } from './v1/index.js';
import { type PublicKey as PreForkPublicKey } from './v1/KeyStore.js';
import { type WalletSyncUpdate as PreForkSyncUpdate } from './v1/SyncSchema.js';
import { CoreWallet, Migration, V2Builder, V2Tag, type V2Variant } from './v2/index.js';
import { type SignSegment } from './v2/Signing.js';
import { type WalletSyncUpdate as PostForkSyncUpdate } from './v2/SyncSchema.js';
import {
  type FinalizedTransactionBalanceResult,
  type TokenTransfer,
  type UnboundTransactionBalanceResult,
  type UnprovenTransactionBalanceResult,
} from './v2/Transacting.js';
import { type UnboundTransaction } from './v2/TransactionOps.js';
import { type UtxoWithMeta } from './v2/UnshieldedState.js';
import { type WalletError } from './v2/WalletError.js';

/**
 * Raised when a transaction is asked for while the wallet is still on the pre-fork protocol version.
 *
 * @remarks
 *   **This seam is temporary and must not survive to general availability.** Mainnet is pre-fork until the fork happens,
 *   so a wallet that cannot move Night pre-fork cannot be the wallet that ships. It closes with the proving-routing
 *   increment (WP-11 together with the carrier and author flows), which routes a recipe to the prover that speaks the
 *   protocol version it was built at; until then the only proving path this SDK has speaks the post-fork ledger
 *   version, and there is nothing honest for the pre-fork branch to return — every operation gated below either takes
 *   or produces a transaction of the post-fork ledger version, which the pre-fork variant cannot even hold.
 *
 *   Everything else works on both sides of the boundary: synchronization, the state observable and everything it
 *   projects, balances, coins, the address, serialization, restoring a snapshot, reverting, and the migration itself.
 */
export class PreForkUnshieldedTransactingUnsupportedError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-unshielded-wallet/ForkingUnshieldedWallet/PreForkUnshieldedTransactingUnsupportedError',
)<{
  readonly message: string;
  /** The wallet operation that was asked for. */
  readonly operation: string;
}> {}

/** What a transacting call can fail with: the post-fork variant's own errors, or the pre-fork variant's refusal. */
type TransactingError = WalletError | PreForkUnshieldedTransactingUnsupportedError;

const preForkTransactingUnsupported = (
  operation: string,
): Effect.Effect<never, PreForkUnshieldedTransactingUnsupportedError> =>
  Effect.fail(
    new PreForkUnshieldedTransactingUnsupportedError({
      operation,
      message:
        `${operation} is not available while this wallet is on the pre-fork protocol version: it takes or produces a ` +
        `transaction of the previous ledger version, which this release has no way to prove. Pre-fork transacting ` +
        `arrives with version-routed proving; until then the post-fork path is the one that works. Synchronization, ` +
        `balances, coins, the address, state and serialization are unaffected on either side of the boundary.`,
    }),
  );

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
   *   which variant can _hold_ the identity, and that turns on the signature scheme — see {@link asPreForkPublicKey}. A
   *   schnorr identity begins on the pre-fork variant and follows the chain the whole way; an ecdsa one begins on the
   *   post-fork variant, because the pre-fork ledger version has no way to express it.
   * @param publicKey The identity to watch, in the post-fork ledger version's shape, which is the one this wallet's
   *   public API speaks.
   * @returns A started wallet.
   */
  startWithPublicKey(publicKey: PublicKey): ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
  /**
   * Restores a wallet from a snapshot, into whichever registered variant wrote it.
   *
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, on the variant that owns its protocol version.
   * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
   */
  restore(serializedState: string): ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
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

  return class ForkingUnshieldedWalletImplementation
    extends BaseWallet
    implements ForkingUnshieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>
  {
    static readonly configuration: TConfiguration = configuration;

    static startWithPublicKey(publicKey: PublicKey): ForkingUnshieldedWalletImplementation {
      return Option.match(asPreForkPublicKey(publicKey), {
        // The identity both ledger versions can express: begin where a wallet with no history belongs, below the
        // boundary, and let the runtime hand over when the chain says so.
        onSome: (preForkPublicKey) =>
          ForkingUnshieldedWalletImplementation.startFirst(
            ForkingUnshieldedWalletImplementation,
            PreForkCoreWallet.init(preForkPublicKey, configuration.networkId),
          ),
        // An identity only the post-fork ledger version can express, so it starts on that variant and stays there.
        // Stamped with the boundary version rather than left at the minimum: a variant that starts from a state
        // outside its own activation range reports that on sight, which is how a stranded snapshot heals — and here
        // there is no variant above this one to hand over to. The state does belong to this variant, so it says so.
        onNone: () =>
          ForkingUnshieldedWalletImplementation.startAtVariant(
            ForkingUnshieldedWalletImplementation,
            variants[V2Tag],
            CoreWallet.withProtocolVersion(
              CoreWallet.init(publicKey, configuration.networkId),
              configuration.forkVersion,
            ),
          ),
      });
    }

    static restore(serializedState: string): ForkingUnshieldedWalletImplementation {
      const headVariant = HList.head(ForkingUnshieldedWalletImplementation.allVariants());
      const variant = variantForSnapshot(
        serializedState,
        (version) => ForkingUnshieldedWalletImplementation.variantFor(version),
        headVariant,
      ).pipe(Either.getOrThrow);
      // Stated with its result type because the resolved variant is either of the two, so its deserializer is either
      // of theirs: what comes back is a state of whichever one wrote the snapshot, which is what `startAtVariant`
      // takes.
      const deserialized = Either.getOrThrow<PreForkCoreWallet | CoreWallet, unknown>(
        variant.variant.deserializeState(serializedState),
      );

      return ForkingUnshieldedWalletImplementation.startAtVariant(
        ForkingUnshieldedWalletImplementation,
        variant,
        deserialized,
      );
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

    balanceFinalizedTransaction(tx: ledger.FinalizedTransaction): Promise<FinalizedTransactionBalanceResult> {
      return this.runtime
        .dispatch<FinalizedTransactionBalanceResult, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('balanceFinalizedTransaction'),
          [V2Tag]: (v2) => v2.balanceFinalizedTransaction(tx),
        })
        .pipe(Effect.runPromise);
    }

    balanceUnboundTransaction(tx: UnboundTransaction): Promise<UnboundTransactionBalanceResult> {
      return this.runtime
        .dispatch<UnboundTransactionBalanceResult, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('balanceUnboundTransaction'),
          [V2Tag]: (v2) => v2.balanceUnboundTransaction(tx),
        })
        .pipe(Effect.runPromise);
    }

    balanceUnprovenTransaction(tx: ledger.UnprovenTransaction): Promise<UnprovenTransactionBalanceResult> {
      return this.runtime
        .dispatch<UnprovenTransactionBalanceResult, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('balanceUnprovenTransaction'),
          [V2Tag]: (v2) => v2.balanceUnprovenTransaction(tx),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch<ledger.UnprovenTransaction, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('transferTransaction'),
          [V2Tag]: (v2) => v2.transferTransaction(outputs, ttl),
        })
        .pipe(Effect.runPromise);
    }

    rotateUtxos(
      guaranteedUtxos: readonly UtxoWithMeta[],
      fallibleUtxos: readonly UtxoWithMeta[],
      nightVerifyingKey: ledger.SignatureVerifyingKey,
      ttl: Date,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch<ledger.UnprovenTransaction, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('rotateUtxos'),
          [V2Tag]: (v2) => v2.rotateUtxos(guaranteedUtxos, fallibleUtxos, nightVerifyingKey, ttl),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
      ttl: Date,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch<ledger.UnprovenTransaction, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('initSwap'),
          [V2Tag]: (v2) => v2.initSwap(desiredInputs, desiredOutputs, ttl),
        })
        .pipe(Effect.runPromise);
    }

    signUnprovenTransaction(
      transaction: ledger.UnprovenTransaction,
      signSegment: SignSegment,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch<ledger.UnprovenTransaction, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('signUnprovenTransaction'),
          [V2Tag]: (v2) => v2.signUnprovenTransaction(transaction, signSegment),
        })
        .pipe(Effect.runPromise);
    }

    signUnboundTransaction(transaction: UnboundTransaction, signSegment: SignSegment): Promise<UnboundTransaction> {
      return this.runtime
        .dispatch<UnboundTransaction, TransactingError>({
          [V1Tag]: () => preForkTransactingUnsupported('signUnboundTransaction'),
          [V2Tag]: (v2) => v2.signUnboundTransaction(transaction, signSegment),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * Un-books the UTxOs a transaction of this wallet's had reserved, returning them to the available set.
     *
     * @remarks
     *   Nothing to do on the pre-fork variant, and that is a fact about the wallet rather than a convenience: while
     *   pre-fork transacting is unavailable that variant cannot have built the transaction being reverted, so it has
     *   booked nothing of it to release. The parameter's type says the same thing. Unlike the operations that build
     *   transactions, this needs no proving, so there is nothing here for version-routed proving to unlock later — and
     *   the facade reverts all three wallets together when a submission fails, so a refusal here would strand that
     *   whole path.
     * @param transaction The transaction to un-book.
     */
    revertTransaction(
      transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    ): Promise<void> {
      return this.runtime
        .dispatch<void, WalletError>({
          [V1Tag]: () => Effect.void,
          [V2Tag]: (v2) => v2.revertTransaction(transaction),
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
 *   **Transacting is available only once the wallet is on the post-fork variant** — see
 *   {@link PreForkUnshieldedTransactingUnsupportedError}, a temporary seam that closes with version-routed proving.
 *   Synchronization, balances, coins, addresses, serialization, restore and reverting work on both sides.
 * @param configuration What the wallet and both its variants are built from, including where the boundary lies.
 * @returns The wallet class.
 */
export function UnshieldedWallet(configuration: DefaultUnshieldedConfiguration): UnshieldedWalletClass {
  return CustomForkingUnshieldedWallet(
    configuration,
    { builder: new V1Builder().withDefaults(), configuration },
    {
      builder: new V2Builder().withDefaults().withMigration(() => Migration.makeCrossLedgerMigration()),
      configuration,
    },
  );
}
