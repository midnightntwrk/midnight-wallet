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
 * The contract every shielded wallet composition fulfils, and the state it emits.
 *
 * @remarks
 *   Shared by the single-variant composition (`SingleVariantShieldedWallet.ts`) and the one that spans a protocol
 *   boundary (`ShieldedWallet.ts`), and kept apart from both so that neither has to import the other to speak the same
 *   API. Nothing here knows how many variants are running: a state emission arrives already bound to the capabilities
 *   of the variant that produced it, and everything below that binding is plain data.
 *
 *   Nor does anything here name a ledger version. The data it speaks is declared in `types/ShieldedWalletTypes.ts`, which
 *   both variants are stated in, and a variant's own core state travels sealed, readable only by that variant.
 */
import {
  type AnyTx,
  type NetworkId,
  type ProtocolState,
  type ProtocolVersion,
  type SyncProgress,
  type TokenType,
  type UnprovenTx,
  VariantState,
} from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type ShieldedAddress,
  type ShieldedCoinPublicKey,
  type ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import type { ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type Duration } from 'effect';
import type * as rx from 'rxjs';
import { type CoinsAndBalancesCapability, type KeysCapability } from './types/ShieldedWalletCapabilities.js';
import {
  type AvailableCoin,
  type BatchUpdatesConfig,
  type IndexerClientConnection,
  type PendingCoin,
  type ReservedCoin,
  type ShieldedHistoryStorage,
  type TokenTransfer,
} from './types/ShieldedWalletTypes.js';

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
  progress: () => SyncProgress.SyncProgress;
  balances: () => Record<TokenType, bigint>;
  totalCoins: () => readonly (AvailableCoin | PendingCoin)[];
  availableCoins: () => readonly AvailableCoin[];
  pendingCoins: () => readonly PendingCoin[];
  /** Optional so that a state built by hand, without this projection, still constructs; it then reports none. */
  reservedCoins?: () => readonly ReservedCoin[];
  coinPublicKey: () => ShieldedCoinPublicKey;
  encryptionPublicKey: () => ShieldedEncryptionPublicKey;
  address: () => ShieldedAddress;
  serialize: () => TSerialized;
}>;

/**
 * What a variant reads its own state through: the part of its capability set the wallet state projects, and no more.
 *
 * @remarks
 *   Coins, balances and keys are read through the contracts both variants share (`types/ShieldedWalletCapabilities.ts`).
 *   Serialization is each variant's own, because its deserialization fails with that variant's errors, so only the
 *   `serialize` half is asked for here.
 */
type ShieldedStateReaders<TState, TSerialized> = Readonly<{
  serialization: Readonly<{ serialize(state: TState): TSerialized }>;
  coinsAndBalances: Readonly<
    Pick<
      CoinsAndBalancesCapability<TState>,
      'getAvailableBalances' | 'getTotalCoins' | 'getAvailableCoins' | 'getPendingCoins' | 'getReservedCoins'
    >
  >;
  keys: Readonly<KeysCapability<TState>>;
}>;

export class ShieldedWalletState<TSerialized = string> {
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
    variant: ShieldedStateReaders<TState, TSerialized>,
    state: ProtocolState.ProtocolState<TState>,
  ): ShieldedWalletState<TSerialized> =>
    new ShieldedWalletState<TSerialized>(state.version, VariantState.seal(state.variantTag, state.state), {
      progress: () => state.state.progress,
      balances: () => variant.coinsAndBalances.getAvailableBalances(state.state),
      totalCoins: () => variant.coinsAndBalances.getTotalCoins(state.state),
      availableCoins: () => variant.coinsAndBalances.getAvailableCoins(state.state),
      pendingCoins: () => variant.coinsAndBalances.getPendingCoins(state.state),
      reservedCoins: () => variant.coinsAndBalances.getReservedCoins?.(state.state) ?? [],
      coinPublicKey: () => variant.keys.getCoinPublicKey(state.state),
      encryptionPublicKey: () => variant.keys.getEncryptionPublicKey(state.state),
      address: () => variant.keys.getAddress(state.state),
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

  readonly #projections: ShieldedProjections<TSerialized>;

  get balances(): Record<TokenType, bigint> {
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

  /**
   * Coins booked for a transaction that has not settled: in the wallet, but not spendable until the transaction is
   * included, reverted, or the wallet releases the booking once no transaction spending it can still be included.
   */
  get reservedCoins(): readonly ReservedCoin[] {
    return this.#projections.reservedCoins?.() ?? [];
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
    return this.#projections.progress();
  }

  constructor(
    protocolVersion: ProtocolVersion.ProtocolVersion,
    state: VariantState,
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

export type ShieldedWalletAPI<TKeys = never, TSerialized = string> = {
  readonly state: rx.Observable<ShieldedWalletState<TSerialized>>;

  /**
   * Starts background synchronization from the given ledger keys, and keeps them for every variant that follows.
   *
   * @remarks
   *   Which keys those are is the composition's to declare, not this contract's: a wallet spanning a protocol boundary
   *   takes one ledger version's keys per side of it, a single-variant one only the side its variant runs on. So a hard
   *   fork changes what a composition asks for, never this signature.
   *
   *   A property rather than a method so the compiler checks it in the direction that matters: code holding this type
   *   with its own `TKeys` — a facade with the keys it derives — accepts only wallets those keys can start. `never` by
   *   default, so the bare type stands for any shielded wallet, whose start cannot be called without saying which keys
   *   it takes.
   * @example
   *   ```typescript
   *   const wallet = ShieldedWallet(configuration).restore(snapshot);
   *   await wallet.start({ v8: v8Keys, v9: v9Keys });
   *   ```;
   *
   * @param keys The ledger keys this wallet synchronizes with.
   * @returns Nothing; resolves once synchronization has been started on whichever variant is current.
   */
  readonly start: (keys: TKeys) => Promise<void>;

  /**
   * Balances a transaction with shielded coins.
   *
   * @remarks
   *   No key material is passed: the wallet derives what its current variant needs from what it was started with. A
   *   caller-supplied key object could only ever belong to one ledger version, which is exactly what a wallet spanning
   *   a protocol boundary cannot assume.
   * @example
   *   const ttl = new Date(Date.now() + 10 * 60 * 1000);
   *   const balancing = await wallet.balanceTransaction(tx, ttl);
   *
   * @param tx The transaction to balance.
   * @param ttl The transaction's TTL. It caps how long the coins it spends stay booked, since no spend can be included
   *   after it; without it the booking lasts mainnet's `global_ttl`, 14 days.
   * @returns The balancing transaction, or nothing when none is needed.
   */
  // we can balance bound and unbound txs
  balanceTransaction(tx: AnyTx, ttl?: Date): Promise<ShieldedBalancingResult>;

  /**
   * Builds a transaction paying `outputs` from the wallet's shielded coins.
   *
   * @example
   *   const ttl = new Date(Date.now() + 10 * 60 * 1000);
   *   const transfer = await wallet.transferTransaction([{ type, amount: 100n, receiverAddress }], ttl);
   *
   * @param outputs The payments to make.
   * @param ttl The transaction's TTL. It caps how long the coins it spends stay booked, since no spend can be included
   *   after it; without it the booking lasts mainnet's `global_ttl`, 14 days.
   * @returns The unproven transfer.
   */
  transferTransaction(outputs: readonly TokenTransfer[], ttl?: Date): Promise<UnprovenTx>;

  /**
   * Builds one side of a swap: the wallet's coins offered for `desiredInputs`, and `desiredOutputs` asked in return.
   *
   * @example
   *   const ttl = new Date(Date.now() + 10 * 60 * 1000);
   *   const swap = await wallet.initSwap({ [offeredType]: 50n }, [{ type, amount: 100n, receiverAddress }], ttl);
   *
   * @param desiredInputs What the wallet offers, by token type.
   * @param desiredOutputs What the wallet wants to receive.
   * @param ttl The transaction's TTL. It caps how long the coins it spends stay booked, since no spend can be included
   *   after it; without it the booking lasts mainnet's `global_ttl`, 14 days.
   * @returns The unproven swap offer.
   */
  initSwap(
    desiredInputs: Record<TokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
    ttl?: Date,
  ): Promise<UnprovenTx>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<ShieldedWalletState<TSerialized>>;

  getAddress(): Promise<ShieldedAddress>;

  revertTransaction(transaction: AnyTx): Promise<void>;

  stop(): Promise<void>;
};

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
