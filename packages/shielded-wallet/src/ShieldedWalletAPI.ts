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
 */
import type * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  type NetworkId,
  type ProtocolState,
  ProtocolVersion,
  type SyncProgress,
  type UnprovenTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type ShieldedAddress,
  type ShieldedCoinPublicKey,
  type ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import type { ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import type { UnboundTransaction } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { type Duration } from 'effect';
import type * as rx from 'rxjs';
import { type CoreWallet as V1CoreWallet } from './v1/CoreWallet.js';
import { type AvailableCoin, type CoinsAndBalancesCapability, type PendingCoin } from './v2/CoinsAndBalances.js';
import { type CoreWallet } from './v2/index.js';
import { type KeysCapability } from './v2/Keys.js';
import { type SerializationCapability } from './v2/Serialization.js';
import { type BatchUpdatesConfig, type IndexerClientConnection } from './v2/Sync.js';
import { type TokenTransfer } from './v2/Transacting.js';
import { type ShieldedHistoryStorage, type TransactionHistoryService } from './v2/TransactionHistory.js';

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
