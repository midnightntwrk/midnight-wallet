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
import {
  type AnyTx,
  type NetworkId,
  type ProtocolState,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type SyncProgress,
  type UnprovenTx,
  WalletSeed,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type BaseV2Configuration,
  type DefaultV2Configuration,
  type RunningV2Variant,
  V2Tag,
  type V2Variant,
  CoreWallet,
} from './v2/index.js';
import * as ledger from '@midnightntwrk/ledger-v9';
import { type Duration, Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type SerializationCapability } from './v2/Serialization.js';
import { type WalletError } from './v2/WalletError.js';
import { type AvailableCoin, type CoinsAndBalancesCapability, type PendingCoin } from './v2/CoinsAndBalances.js';
import { type KeysCapability } from './v2/Keys.js';
import {
  type ShieldedAddress,
  type ShieldedCoinPublicKey,
  type ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { type TokenTransfer } from './v2/Transacting.js';
import { type BatchUpdatesConfig, type IndexerClientConnection, type WalletSyncUpdate } from './v2/Sync.js';
import { type ShieldedHistoryStorage, type TransactionHistoryService } from './v2/TransactionHistory.js';
import { type CoreWallet as V1CoreWallet } from './v1/CoreWallet.js';
import {
  StartMaterial,
  type Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import type { ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import type { UnboundTransaction } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { EitherOps, HList, Poly } from '@midnightntwrk/wallet-sdk-utilities';
import { variantForSnapshot } from './Restore.js';

export type ShieldedWalletCapabilities<TSerialized = string> = {
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
};

export type ShieldedWalletServices = {
  transactionHistory: TransactionHistoryService;
};

/**
 * A transaction that has been proven but not yet bound.
 *
 * @remarks
 *   Owned by the proving capability, which is what produces one, and re-exported here so the name stays where callers
 *   already reach for it. The shielded wallet neither builds nor consumes one itself.
 */
export type { UnboundTransaction };

/** The core state of whichever shielded variant produced an emission. */
export type ShieldedCoreState = V1CoreWallet | CoreWallet;

/**
 * Everything a state emission projects, already bound to the variant that produced it.
 *
 * @remarks
 *   Binding is the point. The capabilities that understand a state and the state itself must be chosen together, in the
 *   branch where the producing variant is known; the two variants' capability types are structurally identical, so a
 *   capability of one would type-check against a state of the other and be wrong at runtime. Once bound there is
 *   nothing left to mis-pair, and everything below is version-agnostic plain data.
 */
type ShieldedProjections<TSerialized> = Readonly<{
  balances: () => Record<ledger.RawTokenType, bigint>;
  totalCoins: () => readonly (AvailableCoin | PendingCoin)[];
  availableCoins: () => readonly AvailableCoin[];
  pendingCoins: () => readonly PendingCoin[];
  coinPublicKey: () => ShieldedCoinPublicKey;
  encryptionPublicKey: () => ShieldedEncryptionPublicKey;
  address: () => ShieldedAddress;
  serialize: () => TSerialized;
}>;

/** The capability set a variant exposes for reading and serializing its own state. */
type ShieldedStateCapabilities<TState, TSerialized> = Readonly<{
  serialization: SerializationCapability<TState, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<TState>;
  keys: KeysCapability<TState>;
}>;

export class ShieldedWalletState<TSerialized = string, _TTransaction = ledger.FinalizedTransaction> {
  /**
   * Wraps a state emission with the capabilities of the variant that produced it.
   *
   * @remarks
   *   Call this inside a branch that has narrowed on the emission's `variantTag`, so `variant` and `state` are known to
   *   belong together. It is generic over the state type precisely so that pairing is checked.
   */
  static readonly fromVariant = <TState, TSerialized = string>(
    variant: ShieldedStateCapabilities<TState, TSerialized>,
    state: ProtocolState.ProtocolState<TState>,
  ): ShieldedWalletState<TSerialized> =>
    new ShieldedWalletState<TSerialized>(state.version, state.state as ShieldedCoreState, {
      balances: () => variant.coinsAndBalances.getAvailableBalances(state.state),
      totalCoins: () => variant.coinsAndBalances.getTotalCoins(state.state),
      availableCoins: () => variant.coinsAndBalances.getAvailableCoins(state.state),
      pendingCoins: () => variant.coinsAndBalances.getPendingCoins(state.state),
      coinPublicKey: () => variant.keys.getCoinPublicKey(state.state),
      encryptionPublicKey: () => variant.keys.getEncryptionPublicKey(state.state),
      address: () => variant.keys.getAddress(state.state),
      serialize: () => variant.serialization.serialize(state.state),
    });

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: ShieldedCoreState;
  readonly #projections: ShieldedProjections<TSerialized>;

  get balances(): Record<ledger.RawTokenType, bigint> {
    return this.#projections.balances();
  }

  get totalCoins(): readonly (AvailableCoin | PendingCoin)[] {
    return this.#projections.totalCoins();
  }

  get availableCoins(): readonly AvailableCoin[] {
    return this.#projections.availableCoins();
  }

  get pendingCoins(): readonly PendingCoin[] {
    return this.#projections.pendingCoins();
  }

  get coinPublicKey(): ShieldedCoinPublicKey {
    return this.#projections.coinPublicKey();
  }

  get encryptionPublicKey(): ShieldedEncryptionPublicKey {
    return this.#projections.encryptionPublicKey();
  }

  get address(): ShieldedAddress {
    return this.#projections.address();
  }

  get progress(): SyncProgress.SyncProgress {
    return this.state.progress;
  }

  constructor(
    protocolVersion: ProtocolVersion.ProtocolVersion,
    state: ShieldedCoreState,
    projections: ShieldedProjections<TSerialized>,
  ) {
    this.protocolVersion = protocolVersion;
    this.state = state;
    this.#projections = projections;
  }

  serialize(): TSerialized {
    return this.#projections.serialize();
  }
}

/**
 * What balancing a transaction with shielded coins produces: a transaction covering the shortfall, when there is one.
 *
 * @remarks
 *   A handle rather than a ledger transaction, because which ledger version built it is the variant's business and not
 *   the caller's. Absent when the wallet had nothing to add — the transaction was already balanced on the shielded
 *   side.
 */
export type ShieldedBalancingResult = UnprovenTx | undefined;

export type ShieldedWalletAPI<
  TStartAux extends ledger.ZswapSecretKeys = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSerialized = string,
> = {
  readonly state: rx.Observable<ShieldedWalletState<TSerialized, TTransaction>>;

  start(secretKeys: TStartAux): Promise<void>;

  /**
   * Balances a transaction with shielded coins.
   *
   * @remarks
   *   No key material is passed: the wallet derives what its current variant needs from what it was started with. A
   *   caller-supplied key object could only ever belong to one ledger version, which is exactly what a wallet spanning
   *   a protocol boundary cannot assume.
   */
  // we can balance bound and unbound txs
  balanceTransaction(tx: AnyTx): Promise<ShieldedBalancingResult>;

  transferTransaction(outputs: readonly TokenTransfer[]): Promise<UnprovenTx>;

  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
  ): Promise<UnprovenTx>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<ShieldedWalletState<TSerialized, TTransaction>>;

  getAddress(): Promise<ShieldedAddress>;

  revertTransaction(transaction: AnyTx): Promise<void>;

  stop(): Promise<void>;
};

export type CustomizedShieldedWallet<
  TStartAux extends ledger.ZswapSecretKeys = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> = ShieldedWalletAPI<TStartAux, TTransaction, TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]>;

/**
 * The protocol version a ledger-v9-native chain hands over at.
 *
 * @deprecated Use {@link ProtocolVersion.V9NativeForkVersion} from `@midnightntwrk/wallet-sdk-abstractions` (or the
 *   umbrella package) — the value is a property of the chain, not of the shielded wallet, and lives with the version
 *   type now. This alias is the same value and will be removed in a later release.
 */
export const V9_NATIVE_FORK_VERSION: ProtocolVersion.ProtocolVersion = ProtocolVersion.V9NativeForkVersion;

/**
 * The configuration a default {@link ShieldedWallet} is built from.
 *
 * @remarks
 *   Declared by this package rather than aliased to a variant's configuration. A wallet that spans a protocol boundary is
 *   built from more than one variant, so no single variant's configuration can be the wallet's public contract: the
 *   package states what it asks an application for, and maps it onto whichever variants it registers.
 *
 *   The field types are still the ones the variants declare, because they are version-agnostic — `configuration.test.ts`
 *   asserts that this type remains interchangeable with what _both_ variants are built from, so a divergence surfaces
 *   as a compile error here instead of as a wallet that cannot be built for one of its variants.
 */
export type DefaultShieldedConfiguration = {
  networkId: NetworkId.NetworkId;
  indexerClientConnection: IndexerClientConnection;
  batchUpdates?: BatchUpdatesConfig;
  txHistoryStorage: ShieldedHistoryStorage;
  transactionDetailsRetryWindow?: Duration.DurationInput;
  /**
   * The protocol version at which this chain hands over from the pre-fork ledger to the post-fork one.
   *
   * @remarks
   *   Required, and deliberately without a default: the wallet registers one variant either side of it, so a wrong value
   *   does not degrade — it decides which ledger version reads the chain. Below this version the pre-fork variant is
   *   active; from it, the post-fork one. The SDK cannot guess it, because it is a property of the chain the
   *   application points at, not of the SDK.
   *
   *   A node reporting a 2.x runtime version reports protocol version `2000000`, which is therefore the value for a
   *   ledger-v9-native chain. The final mainnet fork constant is not yet fixed; a `ProtocolVersion.Forks.*` default
   *   will ship once it is, and this field keeps working unchanged.
   */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /**
   * How the wallet asks the chain which protocol version its timeline starts under, before it chooses a variant to
   * start at.
   *
   * @remarks
   *   Optional, and defaulted rather than absent: left unset, the wallet asks the indexer named by
   *   {@link indexerClientConnection}, which it is about to synchronize from anyway. Supply one to ask something else —
   *   a cache, a node RPC, a value the application already holds — and have it answer the same question: the version of
   *   the chain's **first** block, not its latest. A fresh wallet reads history from the start, so the variant it needs
   *   is the one that can deserialize the first event it fetches; a probe reporting the tip of a chain that forked over
   *   its own history starts the wallet on a ledger version that cannot read what it is about to be served.
   *
   *   The answer is best-effort wherever it comes from: a chain that cannot be reached leaves the wallet starting exactly
   *   where it started before there was a probe.
   */
  chainVersionProbe?: ChainVersionProbe;
};

export interface CustomizedShieldedWalletClass<
  TStartAux extends ledger.ZswapSecretKeys = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV2Configuration = DefaultShieldedConfiguration,
> extends WalletLike.BaseWalletClass<
  [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
> {
  configuration: TConfig;
  startWithSeed(seed: Uint8Array): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  startWithSecretKeys(
    secretKeys: ledger.ZswapSecretKeys,
  ): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
}

/**
 * Builds a shielded wallet class over a single variant.
 *
 * @remarks
 *   One variant, and therefore one ledger version: this is the composition for a wallet that is not expected to meet a
 *   protocol boundary — a test harness, a simulator-driven wallet, an application pinned to one protocol version. The
 *   wallet this package ships is `ShieldedWallet`, which registers a variant either side of the boundary.
 * @param configuration What the variant is built from.
 * @param builder The variant builder.
 * @returns The wallet class.
 */
export function CustomShieldedWallet<
  TConfig extends BaseV2Configuration = DefaultV2Configuration,
  TStartAux extends ledger.ZswapSecretKeys = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>,
): CustomizedShieldedWalletClass<TStartAux, TTransaction, TSyncUpdate, TSerialized, TConfig> {
  const buildArgs = [configuration] as WalletBuilder.BuildArguments<
    [
      VariantBuilder.VersionedVariantBuilder<
        VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>
      >,
    ]
  >;
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(...buildArgs) as WalletLike.BaseWalletClass<
    [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>],
    TConfig
  >;

  return class CustomShieldedWalletImplementation
    extends BaseWallet
    implements CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>
  {
    static startWithSecretKeys(secretKeys: ledger.ZswapSecretKeys): CustomShieldedWalletImplementation {
      return CustomShieldedWalletImplementation.startFirst(
        CustomShieldedWalletImplementation,
        CoreWallet.initEmpty(secretKeys, CustomShieldedWalletImplementation.configuration.networkId),
      );
    }

    /**
     * Builds a wallet from a seed, and remembers the seed.
     *
     * @remarks
     *   The seed is the only key material that crosses a protocol boundary, so a wallet built this way can start
     *   synchronization on any variant it is ever migrated to — each derives its own from the seed. A wallet built from
     *   key objects instead can only start the variants it was given objects for.
     */
    static startWithSeed(seed: Uint8Array): CustomShieldedWalletImplementation {
      const walletSeed = WalletSeed.WalletSeed(seed);
      const secretKeys: ledger.ZswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(walletSeed);
      const wallet = CustomShieldedWalletImplementation.startWithSecretKeys(secretKeys);
      wallet.#retainSeed(walletSeed);
      return wallet;
    }

    /**
     * Restores a wallet from a snapshot, into whichever registered variant wrote it.
     *
     * @remarks
     *   The snapshot declares the protocol version it was written at, so the variant that can read it is a lookup rather
     *   than an assumption. A snapshot written before snapshots declared a version, or a serialization format this
     *   wallet does not recognise as an envelope at all, restores into the head variant — which is what every restore
     *   did before there was more than one variant to choose between.
     * @param serializedState The serialized wallet state.
     * @returns A wallet started from that state, on the variant that owns its protocol version.
     * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
     */
    static restore(serializedState: TSerialized): CustomShieldedWalletImplementation {
      const headVariant = HList.head(CustomShieldedWalletImplementation.allVariants());
      const routed =
        // Routing reads a serialized envelope, which only a wallet keeping the default string serialization has. A
        // custom format is left with the behaviour it has always had.
        typeof serializedState === 'string'
          ? variantForSnapshot(
              serializedState,
              (version) => CustomShieldedWalletImplementation.variantFor(version),
              headVariant,
            )
          : Either.right(headVariant);

      const variant = routed.pipe(Either.getOrThrow);
      const deserialized = variant.variant.deserializeState(serializedState).pipe(Either.getOrThrow);

      return CustomShieldedWalletImplementation.startAtVariant(
        CustomShieldedWalletImplementation,
        variant,
        deserialized,
      );
    }

    readonly state: rx.Observable<ShieldedWalletState<TSerialized>>;

    /**
     * What the application started this wallet with, kept so synchronization can be started again.
     *
     * @remarks
     *   A migration starts a fresh variant whose sync has never run, and sync needs key material. That material cannot
     *   come from the state — it is deliberately absent from anything serialized — and does not exist when the wallet
     *   is first constructed, so it is held here, in memory, for the lifetime of the wallet. Cleared by {@link stop} so
     *   a stopped wallet cannot be silently resurrected by a late activation.
     *
     *   A retained seed answers for every variant. Retained key objects answer only for the variants they were supplied
     *   for, and accumulate per variant tag as `start` is called, which is the same product a caller holding key
     *   objects for both protocol versions would hand over at once.
     */
    readonly #retainedStartMaterial = Ref.unsafeMake<Option.Option<StartMaterial.StartMaterial<TStartAux>>>(
      Option.none(),
    );

    /** Remembers a seed, which supersedes any key objects retained for individual variants. */
    #retainSeed(seed: WalletSeed.WalletSeed): void {
      Ref.set(this.#retainedStartMaterial, Option.some(StartMaterial.fromSeed<TStartAux>(seed))).pipe(Effect.runSync);
    }

    /**
     * Starts synchronization on a variant that has just become current, with key material it can use.
     *
     * @remarks
     *   The derivation is the activating variant's own, so a wallet retaining a seed hands each variant key material
     *   built by its own ledger version. A wallet retaining key objects for other variants only cannot answer, and says
     *   so rather than handing over keys the variant would silently misuse.
     */
    #resumeSyncOn(
      variantTag: typeof V2Tag,
      running: { startSyncInBackground: (aux: TStartAux) => Effect.Effect<void> },
    ): Effect.Effect<void, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedStartMaterial).pipe(
        Effect.flatMap(
          Option.match({
            // Stopped, or never started: there is nothing to resume and nothing to resume it with.
            onNone: () => Effect.void,
            onSome: (retained: StartMaterial.StartMaterial<TStartAux>) =>
              EitherOps.toEffect(
                StartMaterial.requireAuxFor(retained, variantTag, (seed) =>
                  CustomShieldedWalletImplementation.allVariantsRecord()[variantTag].variant.startAux.fromSeed(seed),
                ),
              ).pipe(Effect.flatMap((aux) => running.startSyncInBackground(aux))),
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

    constructor(
      runtime: Runtime.Runtime<
        [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
      >,
      scope: Scope.CloseableScope,
    ) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map((emission) =>
          // One variant, so the pairing is trivial here; the forking wallet narrows on `variantTag` first.
          ShieldedWalletState.fromVariant<CoreWallet, TSerialized>(
            CustomShieldedWalletImplementation.allVariantsRecord()[V2Tag].variant,
            emission,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKeys: TStartAux): Promise<void> {
      return Effect.gen(this, function* () {
        const current = yield* this.runtime.currentVariant;
        yield* Ref.update(this.#retainedStartMaterial, (retained) =>
          Option.some(
            Option.match(retained, {
              onNone: () => StartMaterial.forVariant<TStartAux>(Poly.getTag(current), secretKeys),
              // A retained seed already answers for every variant, including ones this wallet has not met, so key
              // objects for one of them add nothing. Otherwise the objects accumulate per variant tag.
              onSome: (existing: StartMaterial.StartMaterial<TStartAux>) =>
                existing._tag === 'FromSeed'
                  ? existing
                  : StartMaterial.forVariants<TStartAux>([...existing.byTag, [Poly.getTag(current), secretKeys]]),
            }),
          ),
        );

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V2Tag]: (v2: RunningV2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>) =>
              this.#resumeSyncOn(V2Tag, v2),
          });
        }

        yield* this.runtime.dispatch({ [V2Tag]: (v2) => v2.startSyncInBackground(secretKeys) });
      }).pipe(Effect.runPromise);
    }

    async stop(): Promise<void> {
      // Released before the runtime is torn down: the key material outlives neither the wallet nor an in-flight
      // activation.
      Ref.set(this.#retainedStartMaterial, Option.none()).pipe(Effect.runSync);
      await super.stop();
    }

    /**
     * The key material this wallet's one variant uses, from what it was started with.
     *
     * @remarks
     *   Typed as the variant's own start-aux, which for a single-variant wallet is whatever the application handed to
     *   `start` — there is no other variant to derive for, so a retained seed is only ever used through the variant's
     *   own derivation.
     */
    #requireAux(): Effect.Effect<TStartAux, StartMaterial.MissingStartAuxError> {
      return Effect.gen(this, function* () {
        const current = yield* this.runtime.currentVariant;
        const variantTag = Poly.getTag(current);
        const retained = yield* Ref.get(this.#retainedStartMaterial);
        return yield* Option.match(retained, {
          onNone: () =>
            Effect.fail(
              new StartMaterial.MissingStartAuxError({
                message:
                  `This wallet holds no key material: it has not been started, or it has been stopped. Start it ` +
                  `before asking it to build a transaction.`,
                variantTag,
              }),
            ),
          onSome: (material: StartMaterial.StartMaterial<TStartAux>) =>
            EitherOps.toEffect(
              StartMaterial.requireAuxFor(material, variantTag, (seed) =>
                CustomShieldedWalletImplementation.allVariantsRecord()[V2Tag].variant.startAux.fromSeed(seed),
              ),
            ),
        });
      });
    }

    /** The whole of the protocol timeline: one variant answers for every version this wallet will ever see. */
    static readonly #epoch = ProtocolVersion.epochOf(
      ProtocolVersion.MinSupportedVersion,
      ProtocolVersion.MinSupportedVersion,
    );

    balanceTransaction(tx: AnyTx): Promise<ShieldedBalancingResult> {
      return this.runtime
        .dispatch<
          ShieldedBalancingResult,
          WalletError | StartMaterial.MissingStartAuxError | ProtocolVersionMismatchError
        >({
          [V2Tag]: (v2) =>
            Effect.all([
              this.#requireAux(),
              EitherOps.toEffect(
                WalletTransaction.unwrapWithin<
                  ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>
                >(tx, CustomShieldedWalletImplementation.#epoch),
              ),
            ]).pipe(
              Effect.flatMap(([keys, unwrapped]) => v2.balanceTransaction(keys, unwrapped)),
              Effect.map((result) =>
                result === undefined
                  ? undefined
                  : WalletTransaction.adopt('Unproven', result, ProtocolVersion.MinSupportedVersion),
              ),
            ),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[]): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, WalletError | StartMaterial.MissingStartAuxError>({
          [V2Tag]: (v2) =>
            this.#requireAux().pipe(
              Effect.flatMap((keys) => v2.transferTransaction(keys, outputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, ProtocolVersion.MinSupportedVersion)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, WalletError | StartMaterial.MissingStartAuxError>({
          [V2Tag]: (v2) =>
            this.#requireAux().pipe(
              Effect.flatMap((keys) => v2.initSwap(keys, desiredInputs, desiredOutputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, ProtocolVersion.MinSupportedVersion)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch<void, WalletError>({
          [V2Tag]: (v2) =>
            Either.match(
              WalletTransaction.unwrapWithin<
                ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>
              >(transaction, CustomShieldedWalletImplementation.#epoch),
              { onLeft: () => Effect.void, onRight: (unwrapped) => v2.revertTransaction(unwrapped) },
            ),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<ShieldedWalletState<TSerialized>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state It's preferable to use [[ShieldedWalletState.serialize]] instead, to know
     * exactly, which state is serialized
     */
    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<ShieldedAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
