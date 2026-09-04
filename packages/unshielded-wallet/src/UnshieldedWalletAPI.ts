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
 * The contract every unshielded wallet composition fulfils, and the state it emits.
 *
 * @remarks
 *   Shared by the single-variant composition (`SingleVariantUnshieldedWallet.ts`) and the one that spans a protocol
 *   boundary (`UnshieldedWallet.ts`), and kept apart from both so that neither has to import the other to speak the
 *   same API. Nothing here knows how many variants are running: a state emission arrives already bound to the
 *   capabilities of the variant that produced it, and everything below that binding is plain data.
 */
import type * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  type NetworkId,
  type ProtocolState,
  type ProtocolVersion,
  type UnboundTx,
  type UnprovenTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import type * as rx from 'rxjs';
import { type CoreWallet as PreForkCoreWallet } from './v1/CoreWallet.js';
import { type CoinsAndBalancesCapability } from './v2/CoinsAndBalances.js';
import { type CoreWallet } from './v2/index.js';
import { type KeysCapability } from './v2/Keys.js';
import { type SerializationCapability } from './v2/Serialization.js';
import { type SignSegment } from './v2/Signing.js';
import { type IndexerClientConnection } from './v2/Sync.js';
import { type SyncProgress } from './v2/SyncProgress.js';
import { type TokenTransfer } from './v2/Transacting.js';
import { type UnshieldedHistoryStorage } from './v2/TransactionHistory.js';
import { type UtxoWithMeta } from './v2/UnshieldedState.js';

/** The core state of whichever unshielded variant produced an emission. */
export type UnshieldedCoreState = PreForkCoreWallet | CoreWallet;

/**
 * Everything a state emission projects, already bound to the variant that produced it.
 *
 * @remarks
 *   Binding is the point. The capabilities that understand a state and the state itself must be chosen together, in the
 *   branch where the producing variant is known; the two variants' capability types are structurally identical, so a
 *   capability of one would type-check against a state of the other and be wrong at runtime. Once bound there is
 *   nothing left to mis-pair, and everything below is version-agnostic plain data — balances are `bigint` under string
 *   token types, a UTXO is a plain record of value, owner, type, intent hash and output number, and the address is the
 *   SDK's own type. The one genuinely version-bound reading a variant offers, the verifying key, is deliberately not
 *   projected here: it is a bare hex string on one side and a `{tag, value}` record on the other.
 */
type UnshieldedProjections<TSerialized> = Readonly<{
  balances: () => Record<ledger.RawTokenType, bigint>;
  totalCoins: () => readonly UtxoWithMeta[];
  availableCoins: () => readonly UtxoWithMeta[];
  pendingCoins: () => readonly UtxoWithMeta[];
  address: () => UnshieldedAddress;
  serialize: () => TSerialized;
}>;

/**
 * What a variant has to offer for its own state to be projected — exactly that, and nothing more.
 *
 * @remarks
 *   Narrowed to the projected methods rather than naming the three capability types whole, because one of their members
 *   is the version break itself: `KeysCapability.getPublicKey` answers with a bare hex string on the pre-fork ledger
 *   version and a `{tag, value}` record on the post-fork one, so a type demanding it could only ever be satisfied by
 *   one of the two variants. Asking for what is projected keeps a wallet spanning the boundary buildable and keeps the
 *   unprojectable reading out of reach, in one stroke.
 */
type UnshieldedStateCapabilities<TState, TSerialized> = Readonly<{
  serialization: Pick<SerializationCapability<TState, TSerialized>, 'serialize'>;
  coinsAndBalances: Pick<
    CoinsAndBalancesCapability<TState>,
    'getAvailableBalances' | 'getTotalCoins' | 'getAvailableCoins' | 'getPendingCoins'
  >;
  keys: Pick<KeysCapability<TState>, 'getAddress'>;
}>;

export class UnshieldedWalletState<TSerialized = string> {
  /**
   * Wraps a state emission with the capabilities of the variant that produced it.
   *
   * @remarks
   *   Call this inside a branch that has narrowed on the emission's `variantTag`, so `variant` and `state` are known to
   *   belong together. It is generic over the state type precisely so that pairing is checked.
   */
  static readonly fromVariant = <TState extends UnshieldedCoreState, TSerialized = string>(
    variant: UnshieldedStateCapabilities<TState, TSerialized>,
    state: ProtocolState.ProtocolState<TState>,
  ): UnshieldedWalletState<TSerialized> =>
    new UnshieldedWalletState<TSerialized>(state.version, state.state, {
      balances: () => variant.coinsAndBalances.getAvailableBalances(state.state),
      totalCoins: () => variant.coinsAndBalances.getTotalCoins(state.state),
      availableCoins: () => variant.coinsAndBalances.getAvailableCoins(state.state),
      pendingCoins: () => variant.coinsAndBalances.getPendingCoins(state.state),
      address: () => variant.keys.getAddress(state.state),
      serialize: () => variant.serialization.serialize(state.state),
    });

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: UnshieldedCoreState;
  readonly #projections: UnshieldedProjections<TSerialized>;

  get balances(): Record<ledger.RawTokenType, bigint> {
    return this.#projections.balances();
  }

  get totalCoins(): readonly UtxoWithMeta[] {
    return this.#projections.totalCoins();
  }

  get availableCoins(): readonly UtxoWithMeta[] {
    return this.#projections.availableCoins();
  }

  get pendingCoins(): readonly UtxoWithMeta[] {
    return this.#projections.pendingCoins();
  }

  get address(): UnshieldedAddress {
    return this.#projections.address();
  }

  get progress(): SyncProgress {
    return this.state.progress;
  }

  constructor(
    protocolVersion: ProtocolVersion.ProtocolVersion,
    state: UnshieldedCoreState,
    projections: UnshieldedProjections<TSerialized>,
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
 * The configuration a default {@link UnshieldedWallet} is built from.
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
export type DefaultUnshieldedConfiguration = {
  networkId: NetworkId.NetworkId;
  indexerClientConnection: IndexerClientConnection;
  txHistoryStorage: UnshieldedHistoryStorage;
  /**
   * Where each ledger version begins on this chain: under `v9`, the protocol version at which it hands over from
   * ledger-v8 to ledger-v9.
   *
   * @remarks
   *   Required, and deliberately without a default: the wallet registers one variant either side of the boundary, so a
   *   wrong value does not degrade — it decides which ledger version reads the chain. Below `forks.v9` the pre-fork
   *   variant is active; from it, the post-fork one. The SDK cannot guess it, because it is a property of the chain the
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

export type UnshieldedWalletAPI<TSerialized = string> = {
  readonly state: rx.Observable<UnshieldedWalletState<TSerialized>>;

  start(): Promise<void>;

  balanceFinalizedTransaction(tx: AnyTx): Promise<UnprovenTx | undefined>;

  balanceUnboundTransaction(tx: AnyTx): Promise<UnboundTx | undefined>;

  balanceUnprovenTransaction(tx: AnyTx): Promise<UnprovenTx | undefined>;

  transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<UnprovenTx>;

  /**
   * Books a caller-supplied set of Night UTxOs and returns an unproven transaction that moves them back to the same
   * owner, split between the guaranteed (segment 0) and fallible (segment 1) sections of a single intent. Booking moves
   * the UTxOs from available to pending so a concurrent build call cannot reuse them. The fallible section is available
   * for callers that want to attach further actions (e.g. a Dust registration) at segment 1.
   */
  rotateUtxos(
    guaranteedUtxos: readonly UtxoWithMeta[],
    fallibleUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    ttl: Date,
  ): Promise<UnprovenTx>;

  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
    ttl: Date,
  ): Promise<UnprovenTx>;

  signUnprovenTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnprovenTx>;

  signUnboundTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnboundTx>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<UnshieldedWalletState<TSerialized>>;

  revertTransaction(transaction: AnyTx): Promise<void>;

  getAddress(): Promise<UnshieldedAddress>;

  stop(): Promise<void>;
};
