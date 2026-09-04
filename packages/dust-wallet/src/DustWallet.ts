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
  type DustParameters,
  LedgerParameters,
  type DustPublicKey,
  DustSecretKey,
  type FinalizedTransaction,
  type Signature,
  type SignatureVerifyingKey,
  type UnprovenTransaction,
} from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  type ProtocolState,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type SyncProgress,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import {
  StartMaterial,
  type Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type BlockData as PricedBlockData } from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { type Clock, EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type Duration, Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type Balance, type CoinsAndBalancesCapability, type UtxoWithFullDustDetails } from './v2/CoinsAndBalances.js';
import { CoreWallet } from './v2/CoreWallet.js';
import { type KeysCapability } from './v2/Keys.js';
import { type RunningV2Variant, V2Tag } from './v2/RunningV2Variant.js';
import { type SerializationCapability } from './v2/Serialization.js';
import { type NightUtxoSplitForDustRegistration } from './v2/Transacting.js';
import { type DustFullInfo, type UtxoWithMeta } from './v2/types/Dust.js';
import { type AnyTransaction } from './v2/types/ledger.js';
import { type BaseV2Configuration, type V2Variant } from './v2/V2Builder.js';
import { type DustHistoryStorage } from './v2/TransactionHistory.js';
import { type CoreWallet as V1CoreWallet } from './v1/CoreWallet.js';
import { type NetworkId, type TotalCostParameters } from './v2/types/index.js';
import { type WalletSyncUpdate } from './v2/SyncSchema.js';

export type { BlockData } from './v2/SyncSchema.js';

import { type TransactionHistoryService } from './v2/TransactionHistory.js';

export type DustWalletCapabilities<TSerialized = string> = {
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
};

export type DustWalletServices = {
  transactionHistory: TransactionHistoryService;
};

/** The core state of whichever dust variant produced an emission. */
export type DustCoreState = V1CoreWallet | CoreWallet;

/**
 * Everything a state emission projects, already bound to the variant that produced it.
 *
 * @remarks
 *   Binding is the point. The capabilities that understand a state and the state itself must be chosen together, in the
 *   branch where the producing variant is known; the two variants' capability types are structurally identical, so a
 *   capability of one would type-check against a state of the other and be wrong at runtime. Once bound there is
 *   nothing left to mis-pair, and everything below is version-agnostic plain data — dust amounts and rates are
 *   `bigint`, times are `Date`, keys and nonces are `bigint`/`string`, and the address is the SDK's own type.
 */
type DustProjections<TSerialized> = Readonly<{
  totalCoins: () => readonly DustFullInfo[];
  availableCoins: () => readonly DustFullInfo[];
  pendingCoins: () => readonly DustFullInfo[];
  publicKey: () => DustPublicKey;
  address: () => DustAddress;
  balance: (time: Date) => Balance;
  estimateDustGeneration: (
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    currentTime: Date,
  ) => ReadonlyArray<UtxoWithFullDustDetails>;
  splitNightUtxos: (nightUtxos: ReadonlyArray<UtxoWithFullDustDetails>) => {
    guaranteed: ReadonlyArray<UtxoWithFullDustDetails>;
    fallible: ReadonlyArray<UtxoWithFullDustDetails>;
  };
  serialize: () => TSerialized;
}>;

/** The capability set a variant exposes for reading and serializing its own state. */
type DustStateCapabilities<TState, TSerialized> = Readonly<{
  serialization: SerializationCapability<TState, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<TState>;
  keys: KeysCapability<TState>;
}>;

export class DustWalletState<TSerialized = string> {
  /**
   * Wraps a state emission with the capabilities of the variant that produced it.
   *
   * @remarks
   *   Call this inside a branch that has narrowed on the emission's `variantTag`, so `variant` and `state` are known to
   *   belong together. It is generic over the state type precisely so that pairing is checked.
   */
  static readonly fromVariant = <TState, TSerialized = string>(
    variant: DustStateCapabilities<TState, TSerialized>,
    state: ProtocolState.ProtocolState<TState>,
  ): DustWalletState<TSerialized> =>
    new DustWalletState<TSerialized>(state.version, state.state as DustCoreState, {
      totalCoins: () => variant.coinsAndBalances.getTotalCoins(state.state),
      availableCoins: () => variant.coinsAndBalances.getAvailableCoins(state.state),
      pendingCoins: () => variant.coinsAndBalances.getPendingCoins(state.state),
      publicKey: () => variant.keys.getPublicKey(state.state),
      address: () => variant.keys.getAddress(state.state),
      balance: (time) => variant.coinsAndBalances.getWalletBalance(state.state, time),
      estimateDustGeneration: (nightUtxos, currentTime) =>
        variant.coinsAndBalances.estimateDustGeneration(state.state, nightUtxos, currentTime),
      splitNightUtxos: (nightUtxos) => variant.coinsAndBalances.splitNightUtxos(nightUtxos),
      serialize: () => variant.serialization.serialize(state.state),
    });

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: DustCoreState;
  readonly #projections: DustProjections<TSerialized>;

  get totalCoins(): readonly DustFullInfo[] {
    return this.#projections.totalCoins();
  }

  get availableCoins(): readonly DustFullInfo[] {
    return this.#projections.availableCoins();
  }

  get pendingCoins(): readonly DustFullInfo[] {
    return this.#projections.pendingCoins();
  }

  get publicKey(): DustPublicKey {
    return this.#projections.publicKey();
  }

  get address(): DustAddress {
    return this.#projections.address();
  }

  get progress(): SyncProgress.SyncProgress {
    return this.state.progress;
  }

  constructor(
    protocolVersion: ProtocolVersion.ProtocolVersion,
    state: DustCoreState,
    projections: DustProjections<TSerialized>,
  ) {
    this.protocolVersion = protocolVersion;
    this.state = state;
    this.#projections = projections;
  }

  balance(time: Date): Balance {
    return this.#projections.balance(time);
  }

  estimateDustGeneration(
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    currentTime: Date,
  ): ReadonlyArray<UtxoWithFullDustDetails> {
    return this.#projections.estimateDustGeneration(nightUtxos, currentTime);
  }

  /**
   * Splits Night UTxOs into the ones a registration puts in its guaranteed and fallible sections.
   *
   * @remarks
   *   Projected here rather than reached for through the capability set, so a reader of this state never has to know
   *   which variant produced it. The split itself is plain arithmetic over plain data — no ledger object crosses it —
   *   which is why both variants answer it identically.
   * @param nightUtxos The UTxOs to split, with their dust generation readings.
   * @returns The guaranteed and fallible halves.
   */
  splitNightUtxos(nightUtxos: ReadonlyArray<UtxoWithFullDustDetails>): {
    guaranteed: ReadonlyArray<UtxoWithFullDustDetails>;
    fallible: ReadonlyArray<UtxoWithFullDustDetails>;
  } {
    return this.#projections.splitNightUtxos(nightUtxos);
  }

  serialize(): TSerialized {
    return this.#projections.serialize();
  }
}

/**
 * The largest fee payment a registration over `nightUtxos` could claim for itself, right now.
 *
 * @remarks
 *   What {@link DustWalletAPI.waitForGeneratedDust} waits to reach the fee, and the reading behind it. Two things shape
 *   it. Only Night that does not yet generate Dust earns the retroactive Dust a registration may spend on its own fee —
 *   claiming it for Night that already generates is an overspend the node rejects — and whether a UTxO is one of those
 *   is its `registeredForDustGeneration` flag, which the indexer reports as of the chain's current Dust epoch. And the
 *   allowance is capped at the _single_ highest-generation UTxO, because `splitNightUtxos` puts exactly one in the
 *   registration's guaranteed slot; summing across UTxOs would resolve the wait optimistically and the registration
 *   would still fail the fee check on-chain.
 * @param state The dust wallet state to read.
 * @param nightUtxos The Night UTxOs the registration would carry.
 * @param currentTime The time to project generation to.
 * @returns The claimable fee payment, in Specks. `0n` when every UTxO is already registered for Dust generation.
 */
export const claimableFeePayment = <TSerialized>(
  state: DustWalletState<TSerialized>,
  nightUtxos: ReadonlyArray<UtxoWithMeta>,
  currentTime: Date,
): bigint =>
  state
    .estimateDustGeneration(nightUtxos, currentTime)
    .filter((estimate) => !estimate.utxo.registeredForDustGeneration)
    .reduce((max, estimate) => (estimate.dust.generatedNow > max ? estimate.dust.generatedNow : max), 0n);

export type DustWalletAPI<TStartAux = DustSecretKey, TSerialized = string> = {
  readonly state: rx.Observable<DustWalletState<TSerialized>>;

  start(secretKey: TStartAux): Promise<void>;

  stepSync(secretKey: TStartAux): Promise<void>;

  createDustGenerationTransaction(
    currentTime: Date | undefined,
    ttl: Date,
    nightUtxos: Array<UtxoWithMeta>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: DustAddress | undefined,
  ): Promise<UnprovenTx>;

  splitNightUtxosForDustRegistration(
    currentTime: Date,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    isRegistration: boolean,
  ): Promise<NightUtxoSplitForDustRegistration>;

  attachDustRegistration(
    transaction: UnprovenTx,
    currentTime: Date,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: DustAddress | undefined,
    feePayment: bigint,
  ): Promise<UnprovenTx>;

  addDustGenerationSignature(transaction: UnprovenTx, signature: Signature): Promise<UnprovenTx>;

  /**
   * Attaches a signature to the DustRegistration in segment 1's `dustActions` only. Unlike
   * {@link addDustGenerationSignature}, this does NOT touch the unshielded offers — those should be signed separately
   * via the unshielded-wallet signing path. Use this when the caller orchestrates signing across both packages (e.g.
   * the facade's `signRecipe`).
   */
  addDustRegistrationSignature(transaction: UnprovenTx, signature: Signature): Promise<UnprovenTx>;

  calculateFee(transactions: ReadonlyArray<AnyTx>): Promise<bigint>;

  /**
   * Estimates what a set of transactions will cost, including the fee of the balancing transaction.
   *
   * @remarks
   *   No key material is passed: the wallet derives what its current variant needs from what it was started with.
   */
  estimateFee(transactions: ReadonlyArray<AnyTx>, ttl?: Date, currentTime?: Date): Promise<bigint>;

  /**
   * Balances a set of transactions by paying their fee in dust.
   *
   * @remarks
   *   The block data returned is the block the fee was priced against, stated in the terms every ledger version reports
   *   identically — the parameters, the height, and the version they were read at. Each variant's own `BlockData`
   *   carries dust index and root fields besides, which are the variant's business and not a caller's.
   */
  balanceTransactions(
    transactions: ReadonlyArray<AnyTx>,
    ttl: Date,
    currentTime?: Date,
  ): Promise<{ transaction: UnprovenTx; blockData: PricedBlockData }>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<DustWalletState<TSerialized>>;

  /**
   * Resolves when the dust projected to be generated by the single highest-generation unregistered Night UTxO reaches
   * `requiredAmount`. The projection is re-evaluated every second so the wait advances even when the dust state stream
   * is quiet. Tracks the same quantity used as `allow_fee_payment` for the registration (the maximum across the UTxOs,
   * not their sum, since `splitNightUtxos` puts only one UTxO in the guaranteed slot), so pairing with
   * `WalletFacade.estimateRegistration` to pick `requiredAmount` guarantees the subsequent
   * `registerNightUtxosForDustGeneration` will pass its fee-coverage guard.
   *
   * @param nightUtxos - UTxOs to project generation for; same set passed to `registerNightUtxosForDustGeneration`.
   *   Already-registered UTxOs are ignored. Must be non-empty.
   * @param requiredAmount - Threshold to wait for, as a Dust amount. Resolves immediately if `<= 0n`.
   * @param clock - Source of current time, read on every tick. Required, and a {@link Clock.Clock} rather than a
   *   snapshot `Date` like the other methods' `currentTime`: the projection only advances because the time is re-read
   *   each tick, and callers must inject their own clock so simulator-driven tests respect simulator time.
   * @param opts.timeoutMs - Deadline, in ms from subscription, for `requiredAmount` to be reached; rejects if it is
   *   not. Default `300_000`.
   * @returns A promise that resolves once the projected dust reaches `requiredAmount`.
   * @throws Error if `nightUtxos` is empty.
   * @throws TimeoutError if `requiredAmount` is not reached within `opts.timeoutMs`.
   */
  waitForGeneratedDust(
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    requiredAmount: bigint,
    clock: Clock.Clock,
    opts?: { timeoutMs?: number },
  ): Promise<void>;

  revertTransaction(transaction: AnyTx): Promise<void>;

  getAddress(): Promise<DustAddress>;

  stop(): Promise<void>;
};

export type CustomizedDustWallet<
  TStartAux = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> = DustWalletAPI<TStartAux, TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]>;

/**
 * The configuration a default {@link DustWallet} is built from.
 *
 * @remarks
 *   Declared by this package rather than aliased to a variant's configuration. A wallet that spans a protocol boundary is
 *   built from more than one variant, so no single variant's configuration can be the wallet's public contract: the
 *   package states what it asks an application for, and maps it onto whichever variants it registers.
 *
 *   `dustParameters` is the one field here that names a ledger type. It is version-agnostic only because the two ledgers'
 *   `DustParameters` are structurally identical; `configuration.test.ts` asserts that, so a divergence surfaces as a
 *   compile error here instead of as a wallet that cannot be built for one of its variants.
 */
export type DefaultDustConfiguration = {
  networkId: NetworkId;
  costParameters: TotalCostParameters;
  dustParameters?: DustParameters;
  txHistoryStorage: DustHistoryStorage;
  indexerClientConnection: { indexerHttpUrl: string };
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
   *   ledger-v9-native chain — the shielded package publishes it as `V9_NATIVE_FORK_VERSION`. The final mainnet fork
   *   constant is not yet fixed; a `ProtocolVersion.Forks.*` default will ship once it is, and this field keeps working
   *   unchanged.
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

export interface CustomizedDustWalletClass<
  TStartAux = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV2Configuration = DefaultDustConfiguration,
> extends WalletLike.BaseWalletClass<
  [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
> {
  configuration: TConfig;
  startWithSeed(
    seed: Uint8Array,
    dustParameters?: DustParameters,
  ): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  startWithSecretKey(
    secretKey: DustSecretKey,
    dustParameters?: DustParameters,
  ): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
}

export function CustomDustWallet<
  TConfig extends BaseV2Configuration = DefaultDustConfiguration,
  TStartAux extends DustSecretKey = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>,
): CustomizedDustWalletClass<TStartAux, TTransaction, TSyncUpdate, TSerialized, TConfig> {
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

  /** The whole of the protocol timeline: one variant answers for every version this wallet will ever see. */
  const wholeTimeline = ProtocolVersion.epochOf(
    ProtocolVersion.MinSupportedVersion,
    ProtocolVersion.MinSupportedVersion,
  );

  /** Seals a transaction this wallet built, at the version its one variant answers from. */
  const seal = (transaction: UnprovenTransaction): UnprovenTx =>
    WalletTransaction.adopt('Unproven', transaction, ProtocolVersion.MinSupportedVersion);

  /** Reads a transaction a caller handed in, which a single-variant wallet accepts at any version. */
  const carried = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, wholeTimeline));

  return class CustomDustWalletImplementation
    extends BaseWallet
    implements CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>
  {
    static startWithSeed(
      seed: Uint8Array,
      // The ledger's own initial parameters when a caller names none: three rates that do not depend on this wallet,
      // and asking for them made an application import a ledger version to start one.
      dustParameters: DustParameters = LedgerParameters.initialParameters().dust,
    ): CustomDustWalletImplementation {
      const dustSecretKey = DustSecretKey.fromSeed(seed);
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, dustSecretKey, CustomDustWalletImplementation.configuration.networkId),
      );
    }

    static startWithSecretKey(
      secretKey: DustSecretKey,
      dustParameters: DustParameters = LedgerParameters.initialParameters().dust,
    ): CustomDustWalletImplementation {
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, secretKey, CustomDustWalletImplementation.configuration.networkId),
      );
    }

    static restore(serializedState: TSerialized): CustomDustWalletImplementation {
      const deserialized: CoreWallet = CustomDustWalletImplementation.allVariantsRecord()
        [V2Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return CustomDustWalletImplementation.startFirst(CustomDustWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<DustWalletState<TSerialized>>;

    /**
     * The start-aux the wallet was last started with.
     *
     * @remarks
     *   Sync needs the dust secret key, and a migration starts a fresh variant whose sync has never been started. The key
     *   cannot come from the state — it is deliberately absent from anything serialized — and it does not exist yet
     *   when the wallet is first constructed, so it is held here, in memory, for the lifetime of the wallet. Cleared by
     *   {@link stop} so a stopped wallet cannot be silently resurrected by a late activation.
     */
    readonly #retainedAux = Ref.unsafeMake<Option.Option<TStartAux>>(Option.none());

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
          DustWalletState.fromVariant<CoreWallet, TSerialized>(
            CustomDustWalletImplementation.allVariantsRecord()[V2Tag].variant,
            emission,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKey: TStartAux): Promise<void> {
      return Effect.gen(this, function* () {
        yield* Ref.set(this.#retainedAux, Option.some(secretKey));

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V2Tag]: (v2: RunningV2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>) =>
              Ref.get(this.#retainedAux).pipe(
                Effect.flatMap(
                  Option.match({
                    // Stopped, or never started: there is nothing to resume and no key to resume it with.
                    onNone: () => Effect.void,
                    onSome: (retained: TStartAux) => v2.startSyncInBackground(retained),
                  }),
                ),
              ),
          });
        }

        yield* this.runtime.dispatch({ [V2Tag]: (v2) => v2.startSyncInBackground(secretKey) });
      }).pipe(Effect.runPromise);
    }

    override async stop(): Promise<void> {
      // Released before the runtime is torn down: the key outlives neither the wallet nor an in-flight activation.
      Ref.set(this.#retainedAux, Option.none()).pipe(Effect.runSync);
      await super.stop();
    }

    stepSync(secretKey: TStartAux): Promise<void> {
      return this.runtime.dispatch({ [V2Tag]: (v2) => v2.sync(secretKey) }).pipe(Effect.runPromise);
    }

    /**
     * The key material this wallet's one variant uses, from what it was started with.
     *
     * @remarks
     *   Fee payment selects dust the wallet owns, so it needs the same secret synchronization does.
     */
    #requireAux(): Effect.Effect<TStartAux, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedAux).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new StartMaterial.MissingStartAuxError({
                  message:
                    `This wallet holds no key material: it has not been started, or it has been stopped. Start it ` +
                    `before asking it to pay a fee.`,
                  variantTag: V2Tag,
                }),
              ),
            onSome: (aux: TStartAux) => Effect.succeed(aux),
          }),
        ),
      );
    }

    async createDustGenerationTransaction(
      currentTime: Date | undefined,
      ttl: Date,
      nightUtxos: Array<UtxoWithMeta>,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            v2
              .createDustGenerationTransaction(currentTime, ttl, nightUtxos, nightVerifyingKey, dustReceiverAddress)
              .pipe(Effect.map(seal)),
        })
        .pipe(Effect.runPromise);
    }

    async splitNightUtxosForDustRegistration(
      currentTime: Date,
      nightUtxos: ReadonlyArray<UtxoWithMeta>,
      isRegistration: boolean,
    ): Promise<NightUtxoSplitForDustRegistration> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.splitNightUtxosForDustRegistration(currentTime, nightUtxos, isRegistration),
        })
        .pipe(Effect.runPromise);
    }

    async attachDustRegistration(
      transaction: UnprovenTx,
      currentTime: Date,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
      feePayment: bigint,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) =>
                v2.attachDustRegistration(tx, currentTime, nightVerifyingKey, dustReceiverAddress, feePayment),
              ),
              Effect.map(seal),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustGenerationSignature(transaction: UnprovenTx, signature: Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustGenerationSignature(tx, signature)),
              Effect.map(seal),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustRegistrationSignature(transaction: UnprovenTx, signature: Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustRegistrationSignature(tx, signature)),
              Effect.map(seal),
            ),
        })
        .pipe(Effect.runPromise);
    }

    calculateFee(transactions: ReadonlyArray<AnyTx>): Promise<bigint> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Effect.forEach(transactions, carried<AnyTransaction>).pipe(Effect.flatMap((txs) => v2.calculateFee(txs))),
        })
        .pipe(Effect.runPromise);
    }

    estimateFee(transactions: ReadonlyArray<AnyTx>, ttl?: Date, currentTime?: Date): Promise<bigint> {
      const effectiveTtl = ttl ?? new Date(Date.now() + 60 * 60 * 1000);
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Effect.all([this.#requireAux(), Effect.forEach(transactions, carried<AnyTransaction>)]).pipe(
              Effect.flatMap(([key, txs]) => v2.estimateFee(key, txs, effectiveTtl, currentTime)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    balanceTransactions(
      transactions: ReadonlyArray<AnyTx>,
      ttl: Date,
      currentTime?: Date,
    ): Promise<{ transaction: UnprovenTx; blockData: PricedBlockData }> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Effect.all([this.#requireAux(), Effect.forEach(transactions, carried<AnyTransaction>)]).pipe(
              Effect.flatMap(([key, txs]) => v2.balanceTransactions(key, txs, ttl, currentTime)),
              Effect.map(({ transaction, blockData }) => ({ transaction: seal(transaction), blockData })),
            ),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Either.match(WalletTransaction.unwrapWithin<AnyTransaction>(transaction, wholeTimeline), {
              onLeft: () => Effect.void,
              onRight: (tx) => v2.revertTransaction(tx),
            }),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<DustWalletState<TSerialized>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    async waitForGeneratedDust(
      nightUtxos: ReadonlyArray<UtxoWithMeta>,
      requiredAmount: bigint,
      clock: Clock.Clock,
      opts?: { timeoutMs?: number },
    ): Promise<void> {
      if (nightUtxos.length === 0) {
        throw Error('At least one Night UTXO is required.');
      }
      if (requiredAmount <= 0n) {
        return;
      }
      const timeoutMs = opts?.timeoutMs ?? 300_000;
      // Combine the dust state stream with a 1 s tick — the dust state only emits when sync
      // updates apply, but the generation projection depends on a current-time reading, which
      // advances continuously. Without a periodic tick the filter would never re-run between
      // state emissions on a quiet wallet, and the wait would hang.
      await rx.firstValueFrom(
        rx.combineLatest([this.state, rx.timer(0, 1000)]).pipe(
          rx.filter(([dustState]) => claimableFeePayment(dustState, nightUtxos, clock.now()) >= requiredAmount),
          rx.timeout({ first: timeoutMs }),
        ),
      );
    }

    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<DustAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
