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
 *
 *   Nor does anything here name a ledger version. The data it speaks is declared in `types/UnshieldedWalletTypes.ts`,
 *   which both variants are stated in, and a variant's own core state travels sealed, readable only by that variant.
 */
import {
  type AnyTx,
  type NetworkId,
  type ProtocolState,
  type ProtocolVersion,
  type TokenType,
  type UnboundTx,
  type UnprovenTx,
  VariantState,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { liftSignatureVerifyingKey, type Signing } from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import type * as rx from 'rxjs';
import { type CoinsAndBalancesCapability } from './types/UnshieldedWalletCapabilities.js';
import {
  type DefaultSyncConfiguration,
  type IndexerClientConnection,
  type SignSegment,
  type SyncProgress,
  type TokenTransfer,
  type UnshieldedHistoryStorage,
  type UtxoHash,
  type UtxoWithMeta,
} from './types/UnshieldedWalletTypes.js';

/**
 * Everything a state emission projects, already bound to the variant that produced it.
 *
 * @remarks
 *   Binding is the point. The capabilities that understand a state and the state itself must be chosen together, in the
 *   branch where the producing variant is known; the two variants' capability types are structurally identical, so a
 *   capability of one would type-check against a state of the other and be wrong at runtime. Once bound there is
 *   nothing left to mis-pair, and everything below is version-agnostic plain data — balances are `bigint` under string
 *   token types, a UTXO is a plain record of value, owner, type, intent hash and output number, and the address is the
 *   SDK's own type. The one genuinely version-bound reading a variant offers, the verifying key — a bare hex string on
 *   one side and a `{tag, value}` record on the other — is projected in the SDK's own signature shape, which
 *   ledger-v8's key is lifted into without loss.
 */
type UnshieldedProjections<TSerialized> = Readonly<{
  progress: () => SyncProgress;
  balances: () => Record<TokenType, bigint>;
  totalCoins: () => readonly UtxoWithMeta[];
  availableCoins: () => readonly UtxoWithMeta[];
  pendingCoins: () => readonly UtxoWithMeta[];
  address: () => UnshieldedAddress;
  verifyingKey: () => Signing.SignatureVerifyingKey;
  serialize: () => TSerialized;
}>;

/**
 * What a variant has to offer for its own state to be projected — exactly that, and nothing more.
 *
 * @remarks
 *   Coins and balances are read through the contract both variants share (`types/UnshieldedWalletCapabilities.ts`).
 *   Serialization is each variant's own, because its deserialization fails with that variant's errors, so only the
 *   `serialize` half is asked for here. Keys are each variant's own too, and are the version break itself:
 *   `KeysCapability.getPublicKey` answers with a bare hex string on ledger-v8 and a `{tag, value}` record on ledger-v9,
 *   so it is asked for as either, and the wallet state lifts the first into the second.
 */
type UnshieldedStateReaders<TState, TSerialized> = Readonly<{
  serialization: Readonly<{ serialize(state: TState): TSerialized }>;
  coinsAndBalances: Readonly<
    Pick<
      CoinsAndBalancesCapability<TState>,
      'getAvailableBalances' | 'getTotalCoins' | 'getAvailableCoins' | 'getPendingCoins'
    >
  >;
  keys: Readonly<{
    getAddress(state: TState): UnshieldedAddress;
    getPublicKey(state: TState): string | Signing.SignatureVerifyingKey;
  }>;
}>;

/** A verifying key in the SDK's signature shape, lifting ledger-v8's bare hex, whose only scheme is schnorr. */
const asSignatureVerifyingKey = (key: string | Signing.SignatureVerifyingKey): Signing.SignatureVerifyingKey =>
  typeof key === 'string' ? liftSignatureVerifyingKey(key) : key;

export class UnshieldedWalletState<TSerialized = string> {
  /**
   * Wraps a state emission with the capabilities of the variant that produced it.
   *
   * @remarks
   *   Call this inside a branch that has narrowed on the emission's `variantTag`, so `variant` and `state` are known to
   *   belong together. It is generic over the state type precisely so that pairing is checked. The state itself is
   *   sealed under that tag, so the producing variant is the only one that can read it back.
   */
  static readonly fromVariant = <TState extends Readonly<{ progress: SyncProgress }>, TSerialized = string>(
    variant: UnshieldedStateReaders<TState, TSerialized>,
    state: ProtocolState.ProtocolState<TState>,
  ): UnshieldedWalletState<TSerialized> =>
    new UnshieldedWalletState<TSerialized>(state.version, VariantState.seal(state.variantTag, state.state), {
      progress: () => state.state.progress,
      balances: () => variant.coinsAndBalances.getAvailableBalances(state.state),
      totalCoins: () => variant.coinsAndBalances.getTotalCoins(state.state),
      availableCoins: () => variant.coinsAndBalances.getAvailableCoins(state.state),
      pendingCoins: () => variant.coinsAndBalances.getPendingCoins(state.state),
      address: () => variant.keys.getAddress(state.state),
      verifyingKey: () => asSignatureVerifyingKey(variant.keys.getPublicKey(state.state)),
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

  readonly #projections: UnshieldedProjections<TSerialized>;

  get balances(): Record<TokenType, bigint> {
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

  /**
   * The key this wallet's signatures verify against, in the SDK's signature shape.
   *
   * @remarks
   *   Whichever variant produced the state: ledger-v8 writes the key as the bare hex of its one scheme, and it is named
   *   here as that scheme's, so the same identity reads the same on either side of the boundary.
   */
  get verifyingKey(): Signing.SignatureVerifyingKey {
    return this.#projections.verifyingKey();
  }

  get progress(): SyncProgress {
    return this.#projections.progress();
  }

  constructor(
    protocolVersion: ProtocolVersion.ProtocolVersion,
    state: VariantState,
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
} & Pick<
  DefaultSyncConfiguration,
  // The liveness cross-check and the booking sweep's clock, which every variant's sync declares the same way and the
  // wallet passes through untouched. Picked rather than redeclared so that a change to a variant's field fails here.
  'clock' | 'nodeClientConnection' | 'livenessConfiguration' | 'livenessPollInterval' | 'relayURL'
>;

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
    nightVerifyingKey: Signing.SignatureVerifyingKey,
    ttl: Date,
  ): Promise<UnprovenTx>;

  initSwap(
    desiredInputs: Record<TokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
    ttl: Date,
  ): Promise<UnprovenTx>;

  signUnprovenTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnprovenTx>;

  signUnboundTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnboundTx>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<UnshieldedWalletState<TSerialized>>;

  revertTransaction(transaction: AnyTx): Promise<void>;

  /**
   * Releases the booked coins named by `utxoIds`, making them spendable again.
   *
   * Use this when the transaction that booked them is not to hand — a caller tracking only the ids it reserved, or a
   * reservation being cleaned up. When the transaction is available, prefer {@link revertTransaction}.
   *
   * @example
   *   ```typescript
   *   await wallet.revertUtxos(['4b0f…#0', '4b0f…#1']);
   *   ```;
   *
   * @param utxoIds - Ids of the coins to release, each `intentHash#outputNo`. An id that is not booked is ignored,
   *   since sync may have cleared the coin first.
   * @returns A promise that resolves once the wallet state has been updated
   */
  revertUtxos(utxoIds: ReadonlyArray<UtxoHash>): Promise<void>;

  /**
   * Releases bookings that came back from a snapshot and that `coveredIds` does not account for.
   *
   * Call this once sync has reached the chain tip: from there, every transaction the address is party to has been
   * applied, so a coin still booked was never spent by the process that booked it. Pass the coins some durable record
   * still accounts for — a transaction waiting on a counterparty, say — and those stay booked.
   *
   * @example
   *   ```typescript
   *   await wallet.releaseRestoredPending(idsStillSpokenFor);
   *   ```;
   *
   * @param coveredIds - Ids of coins to leave booked, each `intentHash#outputNo`
   * @returns A promise that resolves once the wallet state has been updated
   */
  releaseRestoredPending(coveredIds: ReadonlyArray<UtxoHash>): Promise<void>;

  getAddress(): Promise<UnshieldedAddress>;

  stop(): Promise<void>;
};
