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
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import {
  StartMaterial,
  type Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps, HList } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { variantForSnapshot } from './Restore.js';
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
import { type WalletError } from './v2/WalletError.js';

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
};

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
   *   side of the fork. It begins on the pre-fork variant and is handed over when the chain reports a version the
   *   post-fork variant owns, which on a chain that has already forked happens on the first batch it sees.
   * @param seed The seed to derive both ledger versions' keys from.
   * @returns A wallet started on the pre-fork variant.
   */
  startWithSeed(seed: Uint8Array): ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
  /**
   * Builds a wallet from post-fork key objects, starting it on the post-fork variant.
   *
   * @remarks
   *   Key objects belong to one ledger version's runtime, so they answer for one variant and no other: there is nothing
   *   to convert, and the public keys being identical either side does not help — decryption needs the secret. A wallet
   *   built this way therefore starts on the variant its keys belong to and stays there. It cannot read a chain that is
   *   still pre-fork, which is the honest consequence of holding only post-fork keys; start from a seed to do that.
   * @param secretKeys The post-fork ledger version's Zswap secret keys.
   * @returns A wallet started on the post-fork variant.
   */
  startWithSecretKeys(
    secretKeys: ledger.ZswapSecretKeys,
  ): ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
  /**
   * Restores a wallet from a snapshot, into whichever registered variant wrote it.
   *
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, on the variant that owns its protocol version.
   * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
   */
  restore(serializedState: string): ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
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
  type RetainedStartMaterial = StartMaterial.StartMaterial<ledger.ZswapSecretKeys>;

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
   * The pre-fork variant's key material, which only a retained seed can produce.
   *
   * @remarks
   *   The wallet's public API speaks the post-fork ledger version's key objects, and the pre-fork variant cannot use one:
   *   they belong to different ledger runtimes. So a wallet holding key objects has nothing this variant can start
   *   with, and says so instead of handing over keys it would silently misuse.
   */
  const preForkAux = (
    retained: RetainedStartMaterial,
  ): Either.Either<v8.ZswapSecretKeys, StartMaterial.MissingStartAuxError> =>
    StartMaterial.requireDerivedAuxFor(retained, V1Tag, (seed) => variants[V1Tag].variant.startAux.fromSeed(seed));

  /** The post-fork variant's key material: what the application handed over, or the retained seed's derivation. */
  const postForkAux = (
    retained: RetainedStartMaterial,
  ): Either.Either<ledger.ZswapSecretKeys, StartMaterial.MissingStartAuxError> =>
    StartMaterial.requireAuxFor(retained, V2Tag, (seed) => variants[V2Tag].variant.startAux.fromSeed(seed));

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

  return class ForkingShieldedWalletImplementation
    extends BaseWallet
    implements ForkingShieldedWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>
  {
    static readonly configuration: TConfiguration = configuration;

    static startWithSeed(seed: Uint8Array): ForkingShieldedWalletImplementation {
      const walletSeed = WalletSeed.WalletSeed(seed);
      const wallet = ForkingShieldedWalletImplementation.startFirst(
        ForkingShieldedWalletImplementation,
        PreForkCoreWallet.initEmpty(variants[V1Tag].variant.startAux.fromSeed(walletSeed), configuration.networkId),
      );
      wallet.#retainSeed(walletSeed);
      return wallet;
    }

    static startWithSecretKeys(secretKeys: ledger.ZswapSecretKeys): ForkingShieldedWalletImplementation {
      return ForkingShieldedWalletImplementation.startAtVariant(
        ForkingShieldedWalletImplementation,
        variants[V2Tag],
        // Stamped with the boundary version rather than left at the minimum: a variant that starts from a state
        // outside its own activation range reports that on sight, which is how a stranded snapshot heals — and here
        // there is no variant above this one to hand over to. The state does belong to this variant, so it says so.
        CoreWallet.withProtocolVersion(
          CoreWallet.initEmpty(secretKeys, configuration.networkId),
          configuration.forkVersion,
        ),
      );
    }

    static restore(serializedState: string): ForkingShieldedWalletImplementation {
      const headVariant = HList.head(ForkingShieldedWalletImplementation.allVariants());
      const variant = variantForSnapshot(
        serializedState,
        (version) => ForkingShieldedWalletImplementation.variantFor(version),
        headVariant,
      ).pipe(Either.getOrThrow);
      // Stated with its result type because the resolved variant is either of the two, so its deserializer is either
      // of theirs: what comes back is a state of whichever one wrote the snapshot, which is what `startAtVariant`
      // takes.
      const deserialized = Either.getOrThrow<PreForkCoreWallet | CoreWallet, unknown>(
        variant.variant.deserializeState(serializedState),
      );

      return ForkingShieldedWalletImplementation.startAtVariant(
        ForkingShieldedWalletImplementation,
        variant,
        deserialized,
      );
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
    readonly #retainedStartMaterial = Ref.unsafeMake<Option.Option<RetainedStartMaterial>>(Option.none());

    /** Remembers a seed, which supersedes any key objects retained for individual variants. */
    #retainSeed(seed: WalletSeed.WalletSeed): void {
      Ref.set(this.#retainedStartMaterial, Option.some(StartMaterial.fromSeed<ledger.ZswapSecretKeys>(seed))).pipe(
        Effect.runSync,
      );
    }

    /**
     * Starts synchronization on a variant that has just become current, with key material it can use.
     *
     * @param running The variant to start.
     * @param auxFor That variant's own resolution of what it can be started with.
     */
    #resumeSyncOn<TStartAux>(
      running: { startSyncInBackground: (aux: TStartAux) => Effect.Effect<void> },
      auxFor: (retained: RetainedStartMaterial) => Either.Either<TStartAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<void, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedStartMaterial).pipe(
        Effect.flatMap(
          Option.match({
            // Stopped, or never started: there is nothing to resume and nothing to resume it with.
            onNone: () => Effect.void,
            onSome: (retained: RetainedStartMaterial) =>
              EitherOps.toEffect(auxFor(retained)).pipe(Effect.flatMap((aux) => running.startSyncInBackground(aux))),
          }),
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
        yield* Ref.update(this.#retainedStartMaterial, (retained) =>
          Option.some(
            Option.match(retained, {
              onNone: () => StartMaterial.forVariant<ledger.ZswapSecretKeys>(V2Tag, secretKeys),
              // A retained seed already answers for every variant, including ones this wallet has not met, so key
              // objects for one of them add nothing. Otherwise the objects accumulate per variant tag.
              onSome: (existing: RetainedStartMaterial) =>
                existing._tag === 'FromSeed'
                  ? existing
                  : StartMaterial.forVariants<ledger.ZswapSecretKeys>([...existing.byTag, [V2Tag, secretKeys]]),
            }),
          ),
        );

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
      Ref.set(this.#retainedStartMaterial, Option.none()).pipe(Effect.runSync);
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
      auxFor: (retained: RetainedStartMaterial) => Either.Either<TAux, StartMaterial.MissingStartAuxError>,
      variantTag: symbol,
    ): Effect.Effect<TAux, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedStartMaterial).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new StartMaterial.MissingStartAuxError({
                  message:
                    `This wallet holds no key material: it has not been started, or it has been stopped. Start it ` +
                    `before asking it to build a transaction.`,
                  variantTag,
                }),
              ),
            onSome: (retained: RetainedStartMaterial) => EitherOps.toEffect(auxFor(retained)),
          }),
        ),
      );
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
              this.#requireAux(preForkAux, V1Tag),
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
              this.#requireAux(postForkAux, V2Tag),
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
            this.#requireAux(preForkAux, V1Tag).pipe(
              Effect.flatMap((keys) => v1.transferTransaction(keys, outputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            this.#requireAux(postForkAux, V2Tag).pipe(
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
            this.#requireAux(preForkAux, V1Tag).pipe(
              Effect.flatMap((keys) => v1.initSwap(keys, desiredInputs, desiredOutputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            this.#requireAux(postForkAux, V2Tag).pipe(
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
 * @param configuration What the wallet and both its variants are built from, including where the boundary lies.
 * @returns The wallet class.
 */
export function ShieldedWallet(configuration: DefaultShieldedConfiguration): ShieldedWalletClass {
  return CustomForkingShieldedWallet(
    configuration,
    { builder: new V1Builder().withDefaults(), configuration },
    {
      builder: new V2Builder().withDefaults().withMigration(() => Migration.makeCrossLedgerMigration()),
      configuration,
    },
  );
}
