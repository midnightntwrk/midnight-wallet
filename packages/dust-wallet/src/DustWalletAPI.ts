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
 * The contract every dust wallet composition fulfils, and the state it emits.
 *
 * @remarks
 *   Shared by the single-variant composition (`SingleVariantDustWallet.ts`) and the one that spans a protocol boundary
 *   (`DustWallet.ts`), and kept apart from both so that neither has to import the other to speak the same API. Nothing
 *   here knows how many variants are running: a state emission arrives already bound to the capabilities of the variant
 *   that produced it, and everything below that binding is plain data.
 *
 *   Nor does anything here name a ledger version. The data it speaks is declared in `types/DustWalletTypes.ts`, which
 *   both variants are stated in, and a variant's own core state travels sealed, readable only by that variant.
 */
import {
  type AnyTx,
  type NetworkId,
  type ProtocolState,
  type ProtocolVersion,
  type SyncProgress,
  type UnprovenTx,
  VariantState,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type Signing } from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import { type BlockData as PricedBlockData } from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { type Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { type Duration } from 'effect';
import type * as rx from 'rxjs';
import { type CoinsAndBalancesCapability, type KeysCapability } from './types/DustWalletCapabilities.js';
import {
  type Balance,
  type DustFullInfo,
  type DustHistoryStorage,
  type DustPublicKey,
  type NightUtxoSplitForDustRegistration,
  type TotalCostParameters,
  type UtxoWithFullDustDetails,
  type UtxoWithMeta,
} from './types/DustWalletTypes.js';

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
  progress: () => SyncProgress.SyncProgress;
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

/**
 * What a variant reads its own state through: the part of its capability set the wallet state projects, and no more.
 *
 * @remarks
 *   Coins, balances and keys are read through the contracts both variants share (`types/DustWalletCapabilities.ts`).
 *   Serialization is each variant's own, because its deserialization fails with that variant's errors, so only the
 *   `serialize` half is asked for here.
 */
type DustStateReaders<TState, TSerialized> = Readonly<{
  serialization: Readonly<{ serialize(state: TState): TSerialized }>;
  coinsAndBalances: Readonly<
    Pick<
      CoinsAndBalancesCapability<TState>,
      | 'getTotalCoins'
      | 'getAvailableCoins'
      | 'getPendingCoins'
      | 'getWalletBalance'
      | 'estimateDustGeneration'
      | 'splitNightUtxos'
    >
  >;
  keys: Readonly<KeysCapability<TState>>;
}>;

export class DustWalletState<TSerialized = string> {
  /**
   * Wraps a state emission with the capabilities of the variant that produced it.
   *
   * @remarks
   *   Call this inside a branch that has narrowed on the emission's `variantTag`, so `variant` and `state` are known to
   *   belong together. It is generic over the state type precisely so that pairing is checked. The state itself is
   *   sealed under that tag, so the producing variant is the only one that can read it back.
   */
  static readonly fromVariant = <
    TState extends Readonly<{ progress: SyncProgress.SyncProgress }>,
    TSerialized = string,
  >(
    variant: DustStateReaders<TState, TSerialized>,
    state: ProtocolState.ProtocolState<TState>,
  ): DustWalletState<TSerialized> =>
    new DustWalletState<TSerialized>(state.version, VariantState.seal(state.variantTag, state.state), {
      progress: () => state.state.progress,
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

  /**
   * The producing variant's own state, sealed.
   *
   * @remarks
   *   It is made of that variant's ledger version's objects, so only that variant reads it: `coreStateOf` from the `/v1`
   *   or `/v2` subpath hands it over when that variant produced this emission, and nothing otherwise.
   */
  readonly state: VariantState;

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

  get publicKey(): bigint {
    return this.#projections.publicKey();
  }

  get address(): DustAddress {
    return this.#projections.address();
  }

  get progress(): SyncProgress.SyncProgress {
    return this.#projections.progress();
  }

  constructor(
    protocolVersion: ProtocolVersion.ProtocolVersion,
    state: VariantState,
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

export type DustWalletAPI<TKeys = never, TSerialized = string> = {
  readonly state: rx.Observable<DustWalletState<TSerialized>>;

  /**
   * Starts background synchronization from the given ledger keys, and keeps them for every variant that follows.
   *
   * @remarks
   *   Which keys those are is the composition's to declare, not this contract's: a wallet spanning a protocol boundary
   *   takes one ledger version's `DustSecretKey` per side of it, a single-variant one only the side its variant runs
   *   on. So a hard fork changes what a composition asks for, never this signature.
   *
   *   A property rather than a method so the compiler checks it in the direction that matters: code holding this type
   *   with its own `TKeys` — a facade with the keys it derives — accepts only wallets those keys can start. `never` by
   *   default, so the bare type stands for any dust wallet, whose start cannot be called without saying which keys it
   *   takes.
   * @example
   *   ```typescript
   *   const wallet = DustWallet(configuration).restore(snapshot);
   *   await wallet.start({ v8: v8Key, v9: v9Key });
   *   ```;
   *
   * @param keys The ledger keys this wallet synchronizes with.
   * @returns Nothing; resolves once synchronization has been started on whichever variant is current.
   */
  readonly start: (keys: TKeys) => Promise<void>;

  /**
   * Runs one synchronization pass with the given ledger keys, for a wallet driven by hand rather than started.
   *
   * @remarks
   *   Takes the same keys {@link start} does, for the same reason: the caller does not know which variant the wallet is
   *   on, so it hands over what every variant could need and the one running takes its own side. A property for the
   *   same reason too.
   * @example
   *   ```typescript
   *   await wallet.stepSync({ v8: v8Key, v9: v9Key });
   *   ```;
   *
   * @param keys The ledger keys this pass synchronizes with.
   * @returns Nothing; resolves once the pass has finished.
   */
  readonly stepSync: (keys: TKeys) => Promise<void>;

  createDustGenerationTransaction(
    currentTime: Date | undefined,
    ttl: Date,
    nightUtxos: Array<UtxoWithMeta>,
    nightVerifyingKey: Signing.SignatureVerifyingKey,
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
    nightVerifyingKey: Signing.SignatureVerifyingKey,
    dustReceiverAddress: DustAddress | undefined,
    feePayment: bigint,
  ): Promise<UnprovenTx>;

  addDustGenerationSignature(transaction: UnprovenTx, signature: Signing.Signature): Promise<UnprovenTx>;

  /**
   * Attaches a signature to the DustRegistration in segment 1's `dustActions` only. Unlike
   * {@link addDustGenerationSignature}, this does NOT touch the unshielded offers — those should be signed separately
   * via the unshielded-wallet signing path. Use this when the caller orchestrates signing across both packages (e.g.
   * the facade's `signRecipe`).
   */
  addDustRegistrationSignature(transaction: UnprovenTx, signature: Signing.Signature): Promise<UnprovenTx>;

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
   *
   *   The parameters are the pricing variant's own ledger object, of whichever ledger version that is, and so are
   *   `unknown` here: a caller that needs them checks which ledger version's object it holds, and `protocolVersion`
   *   says which to expect.
   */
  balanceTransactions(
    transactions: ReadonlyArray<AnyTx>,
    ttl: Date,
    currentTime?: Date,
  ): Promise<{ transaction: UnprovenTx; blockData: PricedBlockData<unknown> }>;

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

  /**
   * Checks that the fee payment a first-time registration carries covers the registration's own `fee`.
   *
   * @remarks
   *   Judges `feePayment`, the payment the transaction was built with, since that is what reaches the chain; the dust
   *   state is read only to estimate when generation over `nightUtxos` will cover the fee, from the same projection
   *   {@link DustWalletAPI.waitForGeneratedDust} waits on. Unlike the other methods here, a failure rejects with the
   *   typed error itself rather than a fiber wrapper, so a caller can read its fields; recognise it with
   *   `isInsufficientDustForFeeError`.
   * @example
   *   ```ts
   *   await dust.ensureFeeCoverage(now, nightUtxos, split.feePayment, fee).catch((error: unknown) => {
   *     if (isInsufficientDustForFeeError(error)) console.warn(error.message);
   *     throw error;
   *   });
   *   ```;
   *
   * @param currentTime - The time to estimate from; use the one the registration's split was made at.
   * @param nightUtxos - The Night UTxOs the registration carries.
   * @param feePayment - The fee payment attached to the registration, in Specks.
   * @param fee - The registration's fee, in Specks.
   * @returns A promise that resolves when `feePayment` covers `fee`.
   * @throws InsufficientDustForFeeError (`_tag` `'Wallet.InsufficientDustForFee'`) when it does not, carrying the
   *   shortfall and an estimate of when generation will cover it.
   */
  ensureFeeCoverage(
    currentTime: Date,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    feePayment: bigint,
    fee: bigint,
  ): Promise<void>;

  revertTransaction(transaction: AnyTx): Promise<void>;

  getAddress(): Promise<DustAddress>;

  stop(): Promise<void>;
};

/**
 * The rates dust is generated and decays at, as plain data.
 *
 * @remarks
 *   Structurally what both ledger versions' `DustParameters` are — three scalars and nothing else — which is why the
 *   ledger classes remain assignable to this and a caller who already holds one can go on passing it. What it removes
 *   is the reason to obtain one: three numbers do not need a ledger version to express, and asking for a
 *   `LedgerParameters.initialParameters().dust` made an application import a ledger to start a wallet.
 */
export type DustGenerationRates = Readonly<{
  /** How much dust one Night generates, at the cap. */
  nightDustRatio: bigint;
  /** How fast dust decays once its Night is spent. */
  generationDecayRate: bigint;
  /** How long dust survives after its Night is spent. */
  dustGracePeriodSeconds: bigint;
}>;

/**
 * The configuration a default {@link DustWallet} is built from.
 *
 * @remarks
 *   Declared by this package rather than aliased to a variant's configuration. A wallet that spans a protocol boundary is
 *   built from more than one variant, so no single variant's configuration can be the wallet's public contract: the
 *   package states what it asks an application for, and maps it onto whichever variants it registers.
 *
 *   `dustParameters` is the one field a variant is not handed as it is. It is plain rates here, and each variant is built
 *   with its own ledger version's `DustParameters` made from them, since a ledger object belongs to the WASM module
 *   that made it. Left unset, the rates are ledger-v9's initial ones.
 */
export type DefaultDustConfiguration = {
  networkId: NetworkId.NetworkId;
  costParameters: TotalCostParameters;
  dustParameters?: DustGenerationRates;
  txHistoryStorage: DustHistoryStorage;
  indexerClientConnection: { indexerHttpUrl: string };
  transactionDetailsRetryWindow?: Duration.DurationInput;
  /**
   * Where each ledger version begins on this chain: under `v9`, the protocol version at which it hands over from
   * ledger-v8 to ledger-v9.
   *
   * @remarks
   *   Required, and deliberately without a default: the wallet registers one variant either side of the boundary, so a
   *   wrong value does not degrade — it decides which ledger version reads the chain. Below `forks.v9` the ledger-v8
   *   variant is active; from it, the ledger-v9 one. The SDK cannot guess it, because it is a property of the chain the
   *   application points at, not of the SDK.
   *
   *   A map keyed by ledger version rather than a single number, so the next hard fork adds a key instead of changing the
   *   shape of every application's configuration — see {@link ProtocolVersion.ForkSchedule}. A node reporting a 2.x
   *   runtime version reports protocol version `2000000`, which is therefore the value for a ledger-v9-native chain —
   *   published as `ProtocolVersion.V9NativeForkVersion`. The final mainnet fork constant is not yet fixed; it will
   *   join that one once it is, and this field keeps working unchanged.
   */
  forks: ProtocolVersion.ForkSchedule;
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
  /**
   * Whether a fresh start on a chain that has crossed `forks.v9` skips the ledger-v8 dust history, beginning on the V2
   * variant with the dust the chain re-emitted as ledger-v9 events when it crossed the v9 fork.
   *
   * @remarks
   *   Fresh starts only. A restore resumes from the cursor its snapshot carries and is unaffected.
   *
   *   The start looks up the last dust event below `forks.v9` and parks the V2 variant's cursor there, with an empty
   *   state: the state the hand-over at the boundary leaves a wallet in, minus the ledger-v8 replay it would have
   *   thrown away. That state is valued against `dustParameters`, as the hand-over values it, and not against dust
   *   parameters a start is called with. Synchronization then continues by event replay as usual. Read by `DustWallet`
   *   only: a wallet composed with `CustomForkingDustWallet`, such as one whose V2 variant syncs with
   *   `makeEventLessSyncService`, does not see it.
   *
   *   **The wallet's dust transaction history from ledger-v8 will be missing.** History is recorded as events are
   *   applied, and a wallet started this way applies none below the boundary.
   *
   *   Dust only. In a facade configuration the shielded and unshielded wallets still read ledger-v8: the coins they hold
   *   from it cross the fork with them and are found nowhere else.
   *
   *   Specific to the v9 fork rather than a mechanism for later ones: it rests on the chain having re-emitted its dust as
   *   ledger-v9 events when it crossed, which happens once, for that fork. A chain still below `forks.v9`, one born on
   *   ledger-v9, or an indexer that cannot be searched leaves the start as it is without this option.
   * @default false
   */
  skipLedgerV8DustHistory?: boolean;
};
