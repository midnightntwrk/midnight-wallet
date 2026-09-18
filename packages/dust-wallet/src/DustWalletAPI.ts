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
 */
import {
  type DustParameters,
  type DustPublicKey,
  type DustSecretKey,
  type Signature,
  type SignatureVerifyingKey,
} from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  type ProtocolState,
  type ProtocolVersion,
  type SyncProgress,
  type UnprovenTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type BlockData as PricedBlockData } from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { type Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { type Duration } from 'effect';
import type * as rx from 'rxjs';
import { type CoreWallet as V1CoreWallet } from './v1/CoreWallet.js';
import { type Balance, type CoinsAndBalancesCapability, type UtxoWithFullDustDetails } from './v2/CoinsAndBalances.js';
import { type CoreWallet } from './v2/CoreWallet.js';
import { type KeysCapability } from './v2/Keys.js';
import { type SerializationCapability } from './v2/Serialization.js';
import { type NightUtxoSplitForDustRegistration } from './v2/Transacting.js';
import { type DustHistoryStorage, type TransactionHistoryService } from './v2/TransactionHistory.js';
import { type DustFullInfo, type UtxoWithMeta } from './v2/types/Dust.js';
import { type NetworkId, type TotalCostParameters } from './v2/types/index.js';

export type { BlockData } from './v2/SyncSchema.js';

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
};
