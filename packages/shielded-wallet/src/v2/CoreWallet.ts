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
import * as ledger from '@midnightntwrk/ledger-v9';
import { ProtocolVersion, type SnapshotFormat, SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either, Iterable, Option, pipe, Record, Array as Arr } from 'effect';
import { InvalidCoinHashesError, type WalletError } from './WalletError.js';

export type PublicKeys = {
  coinPublicKey: ledger.CoinPublicKey;
  encryptionPublicKey: ledger.EncPublicKey;
};
export const PublicKeys = {
  fromSecretKeys: (secretKeys: ledger.ZswapSecretKeys): PublicKeys => {
    return {
      coinPublicKey: secretKeys.coinPublicKey,
      encryptionPublicKey: secretKeys.encryptionPublicKey,
    };
  },
};

export type CoinHashesMap = Readonly<
  Record<ledger.Nonce, { nullifier: ledger.Nullifier; commitment: ledger.CoinCommitment }>
>;
export const CoinHashesMap = {
  empty: {} satisfies CoinHashesMap,
  pickAllCoins(state: ledger.ZswapLocalState): readonly ledger.ShieldedCoinInfo[] {
    return [...state.coins, ...state.pendingOutputs.values().map(([coin]) => coin)];
  },
  assertValid(map: CoinHashesMap, state: ledger.ZswapLocalState): Either.Either<void, Set<ledger.Nonce>> {
    const coins = CoinHashesMap.pickAllCoins(state);
    const coinNonces = new Set(Iterable.map(coins, (coin) => coin.nonce));
    const definedNonces = new Set(Object.keys(map));
    const missingNonces = coinNonces.difference(definedNonces);
    return missingNonces.size === 0 ? Either.void : Either.left(missingNonces);
  },
  updateWithCoins(
    secretKeys: ledger.ZswapSecretKeys,
    existing: CoinHashesMap,
    coins: Iterable<ledger.ShieldedCoinInfo>,
  ): CoinHashesMap {
    return Record.fromIterableWith(coins, (coin) => [
      coin.nonce,
      existing[coin.nonce] ?? {
        commitment: ledger.coinCommitment(coin, secretKeys.coinPublicKey),
        nullifier: ledger.coinNullifier(coin, secretKeys.coinSecretKey),
      },
    ]);
  },
  updateWithNewCoins(
    secretKeys: ledger.ZswapSecretKeys,
    existing: CoinHashesMap,
    coins: Iterable<ledger.ShieldedCoinInfo>,
  ): CoinHashesMap {
    const newMap = CoinHashesMap.updateWithCoins(secretKeys, CoinHashesMap.empty, coins);
    return Record.union(existing, newMap, (a) => a);
  },
  init(secretKeys: ledger.ZswapSecretKeys, coins: Iterable<ledger.ShieldedCoinInfo>): CoinHashesMap {
    return CoinHashesMap.updateWithCoins(secretKeys, {}, coins);
  },
};

/**
 * What the wallet records about one booked coin: the two times its release is measured by.
 *
 * @remarks
 *   A booking is released strictly after {@link bookingDeadline}`(seen, ttl)`, with `seen` taken as the sweep's own time
 *   when it is first missing.
 *
 *   - `ttl` is the TTL of the transaction the coin was booked for, recorded when the coin is booked. The ledger accepts a
 *       TTL when a coin is spent but does not keep it, so the wallet must, or the transaction's TTL could never shorten
 *       how long the coin stays locked. Absent when the transaction had none.
 *   - `seen` is when sync first saw the booking. Absent until a sweep has run since the coin was booked.
 */
export type Booking = Readonly<{ seen?: Date; ttl?: Date }>;

export type CoreWallet = Readonly<{
  state: ledger.ZswapLocalState;
  publicKeys: PublicKeys;
  protocolVersion: ProtocolVersion.ProtocolVersion;
  progress: SyncProgress.SyncProgress;
  networkId: string;
  coinHashes: CoinHashesMap;
  /**
   * This wallet's coin hashes have never been computed, and {@link CoinHashesMap.empty} means "not yet", not "none".
   *
   * @remarks
   *   Set by the cross-ledger migration and cleared by the first sync update, which is the first moment secret keys are
   *   at hand — see {@link CoreWallet.fromPreviousVersion} and {@link CoreWallet.completeCrossing}. It is also what marks
   *   the wallet as freshly crossed, which is how that step knows the reservations in its local state are ones no
   *   inclusion can ever clear and releases them exactly once. Stated as a field rather than inferred from "empty map
   *   beside a non-empty state" because an empty map is a perfectly good value for a wallet holding nothing, and
   *   overloading it would make one shape mean two things. Being a field, it is also what lets a snapshot taken
   *   mid-crossing declare itself: {@link CoreWallet.restoreWithCoinHashes} goes on rejecting a snapshot whose hashes do
   *   not cover its coins, because only a wallet carrying this marker is permitted the gap. `true` is the only
   *   inhabitant, so "pending" and "absent" are the only two states.
   */
  coinHashesPending?: true;
  /**
   * The transaction history that a 1.0.0 snapshot embedded, as the hex-encoded proven ledger transactions it was
   * written with. Carried across a restore and across the ledger-version boundary, and written back out untouched, so
   * upgrading does not destroy it; this SDK keeps history in its own storage and never reads or adds to this list.
   *
   * Absent for every snapshot written since the field was dropped from the schema, and absent means absent — it is not
   * written back as an empty list, so those snapshots keep the bytes they had.
   */
  legacyTxHistory?: readonly string[];
  /**
   * What the wallet knows about each booked coin, by nonce, beyond the ledger's `pendingSpends`. See {@link Booking} and
   * {@link CoreWallet.expireBookings}.
   *
   * @remarks
   *   A booking is released strictly after {@link bookingDeadline} of its `seen` and `ttl`. The ledger keeps neither, and
   *   its own expiry does nothing, so the wallet keeps both here and saves them with the snapshot: a restart must
   *   neither extend nor shorten how long a coin stays locked. An entry exists only for a coin still booked. Absent
   *   when there is none, so a snapshot of an idle wallet keeps the bytes it had.
   */
  bookings?: Readonly<Record<ledger.Nonce, Booking>>;
  /**
   * The snapshot fields this variant's schema does not declare, exactly as they were read, written back with the next
   * snapshot so a later release that wrote them still finds them. Absent when the snapshot carried none.
   *
   * @remarks
   *   {@link legacyTxHistory} is carried the same way but stays a named field: it predates this bag and is part of this
   *   type's public shape, so folding it in would break callers that read it.
   */
  unknownFields?: SnapshotFormat.UnknownFields;
}>;

/**
 * Releases every coin reservation a wallet carried across the ledger-version boundary.
 *
 * @remarks
 *   `pendingSpends` crosses with the rest of the local state, and on the far side its entries name transactions of a
 *   ledger version the chain has left behind: none of them can be included, so no inclusion will ever clear them, and a
 *   coin held for one would sit outside the available set for the rest of the wallet's life. Re-deriving each spend and
 *   reporting it failed is the ledger's own way of un-booking one: the reservation goes, and the coin stays at the
 *   Merkle index the chain gave it, in a tree of unchanged height and root.
 * @param state The local state as it crossed.
 * @param secretKeys The keys the first sync update arrived with.
 * @returns The same state with nothing reserved.
 */
const releaseStrandedSpends = (
  state: ledger.ZswapLocalState,
  secretKeys: ledger.ZswapSecretKeys,
): ledger.ZswapLocalState =>
  releaseSpends(
    state,
    secretKeys,
    [...state.pendingSpends.values()].map(([coin]) => coin),
  );

/**
 * Releases the reservations `state` holds for `coins`, by re-deriving each spend and reporting it failed — the ledger's
 * own way of un-booking one. The coin stays at the Merkle index the chain gave it, in a tree of unchanged height and
 * root.
 */
const releaseSpends = (
  state: ledger.ZswapLocalState,
  secretKeys: ledger.ZswapSecretKeys,
  coins: readonly ledger.QualifiedShieldedCoinInfo[],
): ledger.ZswapLocalState =>
  pipe(
    coins,
    Arr.reduce(state, (released, coin) =>
      pipe(
        LedgerOps.ledgerTry(() => {
          const [reserved, input] = released.spend(secretKeys, coin, 0);
          return reserved.applyFailed(ledger.ZswapOffer.fromInput(input, coin.type, coin.value));
        }),
        // A reservation the ledger declines to re-derive is left exactly where it already was: one coin is not worth
        // failing the update every other coin in this wallet is waiting on.
        Either.getOrElse(() => released),
      ),
    ),
  );

/**
 * How long a booking may stand when no TTL bounds it: mainnet's `global_ttl`, 14 days.
 *
 * @remarks
 *   A shielded input is valid only while the Merkle root it was proven against is still in the chain's root history,
 *   which drops roots older than `global_ttl`, and the ledger includes no transaction whose TTL lies further ahead than
 *   `global_ttl`. The parameter is not exposed to the SDK, so this is the longest value a shipped parameter set uses. A
 *   chain's own `global_ttl` may be shorter (the ledger's built-in parameters say one hour), which only holds a coin
 *   longer than it needed to be.
 */
export const BOOKING_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The instant after which a booking may be released: when its transaction's TTL ends, or a full
 * {@link BOOKING_LIFETIME_MS} after sync first saw it, whichever comes first.
 *
 * @remarks
 *   A transaction cannot be included after its TTL, and no shielded spend can be included later than the lifetime after
 *   it was built, so neither bound can be waited out. A booking is released strictly after the deadline, never at it: a
 *   spend is valid up to and including it.
 * @example
 *   bookingDeadline(new Date('2026-10-08T12:00:00Z'), new Date('2026-10-08T12:10:00Z')); // 12:10
 *   bookingDeadline(new Date('2026-10-08T12:00:00Z'), undefined); // 2026-10-22T12:00:00Z
 *
 * @param seen When sync first saw the booking.
 * @param ttl The TTL of the transaction the coin was booked for, if it had one.
 * @returns The booking's deadline.
 */
export const bookingDeadline = (seen: Date, ttl: Date | undefined): Date => {
  const lifetimeEnds = seen.getTime() + BOOKING_LIFETIME_MS;
  return new Date(ttl === undefined ? lifetimeEnds : Math.min(ttl.getTime(), lifetimeEnds));
};

/** Sets `bookings`, leaving the field out altogether when it is empty: absent means nothing is recorded. */
const withBookings = (wallet: CoreWallet, bookings: Readonly<Record<ledger.Nonce, Booking>>): CoreWallet => {
  const { bookings: _, ...rest } = wallet;
  return Object.keys(bookings).length === 0 ? rest : { ...rest, bookings };
};

/** The nonces of every coin the local state holds booked. */
const bookedNonces = (state: ledger.ZswapLocalState): ReadonlySet<ledger.Nonce> =>
  new Set([...state.pendingSpends.values()].map(([coin]) => coin.nonce));

export const CoreWallet = {
  init(localState: ledger.ZswapLocalState, secretKeys: ledger.ZswapSecretKeys, networkId: string): CoreWallet {
    const publicKeys = PublicKeys.fromSecretKeys(secretKeys);
    const coinHashes = CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState));
    const progress = SyncProgress.createSyncProgress();
    const protocolVersion = ProtocolVersion.MinSupportedVersion;
    return { state: localState, publicKeys, networkId, coinHashes, progress, protocolVersion };
  },

  empty(publicKeys: PublicKeys, networkId: string): CoreWallet {
    return {
      state: new ledger.ZswapLocalState(),
      publicKeys,
      networkId,
      coinHashes: CoinHashesMap.empty,
      progress: SyncProgress.createSyncProgress(),
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    };
  },

  restore(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    syncProgress: Omit<SyncProgress.SyncProgressData, 'isConnected'>,
    protocolVersion: bigint,
    networkId: string,
  ): CoreWallet {
    const publicKeys = PublicKeys.fromSecretKeys(secretKeys);
    const coinHashes = CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState));
    return {
      state: localState,
      publicKeys,
      networkId,
      coinHashes,
      progress: SyncProgress.createSyncProgress(syncProgress),
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
    };
  },

  restoreWithCoinHashes(
    publicKeys: PublicKeys,
    localState: ledger.ZswapLocalState,
    coinHashes: CoinHashesMap,
    syncProgress: SyncProgress.SyncProgressData,
    protocolVersion: bigint,
    networkId: string,
    legacyTxHistory?: readonly string[],
  ): Either.Either<CoreWallet, WalletError> {
    return CoinHashesMap.assertValid(coinHashes, localState).pipe(
      Either.mapBoth({
        onLeft: (missingNonces) =>
          new InvalidCoinHashesError({ message: 'Missing coin hashes for coins present in the state', missingNonces }),
        onRight: () => ({
          state: localState,
          publicKeys,
          networkId,
          coinHashes,
          progress: SyncProgress.createSyncProgress(syncProgress),
          protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
          // Spread conditionally: a snapshot that carried no embedded history must not gain a `legacyTxHistory` key,
          // so that re-serializing it writes no `txHistory` field it did not already have.
          ...(legacyTxHistory === undefined ? {} : { legacyTxHistory }),
        }),
      }),
    );
  },

  /**
   * Restores a wallet whose coin hashes were never computed — a snapshot taken mid-crossing.
   *
   * @remarks
   *   The counterpart of {@link CoreWallet.restoreWithCoinHashes} for the one shape that validation would otherwise
   *   refuse: a full local state, carried across the ledger-version boundary as bytes, beside an empty hash map. The
   *   hashes are commitments and nullifiers, and computing them needs the secret keys a deserializer does not hold, so
   *   the wallet comes back still marked pending and the first sync update fills them in
   *   ({@link CoreWallet.resolveCoinHashes}). Total: there is nothing here to reject, which is exactly why it is a
   *   separate entry point rather than a flag on the validating one.
   * @param publicKeys The identity the snapshot declared.
   * @param localState The local state the snapshot carried.
   * @param syncProgress Where the snapshot's reading had got to.
   * @param protocolVersion The version the snapshot was written under.
   * @param networkId The network the snapshot claims.
   * @param legacyTxHistory The transaction history the snapshot embedded, when it carried one.
   * @returns A wallet holding that state, its coin hashes still pending.
   */
  restoreWithPendingCoinHashes(
    publicKeys: PublicKeys,
    localState: ledger.ZswapLocalState,
    syncProgress: SyncProgress.SyncProgressData,
    protocolVersion: bigint,
    networkId: string,
    legacyTxHistory?: readonly string[],
  ): CoreWallet {
    return {
      state: localState,
      publicKeys,
      networkId,
      coinHashes: CoinHashesMap.empty,
      coinHashesPending: true,
      progress: SyncProgress.createSyncProgress(syncProgress),
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
      ...(legacyTxHistory === undefined ? {} : { legacyTxHistory }),
    };
  },

  initEmpty(keys: ledger.ZswapSecretKeys, networkId: string): CoreWallet {
    return this.empty(PublicKeys.fromSecretKeys(keys), networkId);
  },

  /**
   * Records an observed protocol version on the wallet, never going backwards.
   *
   * @remarks
   *   The version is a signal, not a measurement: writing one outside the running variant's activation range is what
   *   makes it hand over to the next variant. A source that briefly reports an older version — a reconnect replaying
   *   from an earlier cursor, say — must therefore not be able to drag the wallet back below a boundary it has already
   *   crossed, which would ask the runtime to migrate backwards. Taking the maximum makes that unrepresentable.
   * @param wallet The wallet to annotate.
   * @param version The protocol version just observed.
   * @returns `wallet` unchanged if it already records `version` or a later one, otherwise a copy recording `version`.
   */
  withProtocolVersion(wallet: CoreWallet, version: ProtocolVersion.ProtocolVersion): CoreWallet {
    return version > wallet.protocolVersion ? { ...wallet, protocolVersion: version } : wallet;
  },

  /**
   * Adopts a wallet inherited from the previous ledger version: its local state, its identity, and its position.
   *
   * @remarks
   *   The state passed in is this ledger version's own object, decoded from the previous version's bytes — the two majors
   *   share the `zswap-local-state` codec, so the crossing is a round-trip rather than a reconstruction (see
   *   `Migration.makeCrossLedgerMigration`, and the characterization test that pins the codec). So everything the
   *   previous wallet's tree held arrives intact: its coins at the Merkle indices the chain gave them, the height it
   *   had reached, and the outputs it was still expecting. What also crosses is the public keys, the network, the
   *   protocol version that triggered the hand-over (kept so the new variant starts inside its own activation range
   *   rather than immediately signalling backwards), and the cursor the previous variant stopped at.
   *
   *   **Sync progress is parked at the fork, not rewound**: the previous wallet's cursor crosses unchanged. The indexer
   *   numbers ledger-v9 events onwards from whatever id it had reached when the fork happened, never from zero, so
   *   resuming from the inherited cursor is what puts this wallet in front of them. Rewinding to zero would park it on
   *   a stretch of history that this ledger version's events do not occupy. What does not cross is `isConnected`: no
   *   sync is running behind this state yet.
   *
   *   The one thing the bytes cannot supply is the coin hashes: commitments and nullifiers are computed from the secret
   *   keys, which a migration by design does not hold. They are therefore left empty and marked
   *   {@link CoreWallet.coinHashesPending}, for {@link CoreWallet.completeCrossing} to fill in at the first sync update —
   *   the first place in this variant where keys and state meet. The same step releases the spends the state crossed
   *   with: those transactions belong to the ledger version the chain has left behind and can never be included, so
   *   nothing else would ever free the coins they reserved.
   * @param previous The identity and position read off the previous ledger version's wallet, and its decoded state. Its
   *   embedded transaction history, when it holds one, crosses too: the far side writes it back out and nothing there
   *   could rebuild it.
   * @returns A wallet of this ledger version holding what its predecessor held, positioned at the fork.
   */
  fromPreviousVersion(previous: {
    readonly state: ledger.ZswapLocalState;
    readonly publicKeys: PublicKeys;
    readonly networkId: string;
    readonly protocolVersion: bigint;
    readonly progress: SyncProgress.SyncProgressData;
    readonly legacyTxHistory?: readonly string[];
  }): CoreWallet {
    return {
      state: previous.state,
      publicKeys: previous.publicKeys,
      networkId: previous.networkId,
      coinHashes: CoinHashesMap.empty,
      coinHashesPending: true,
      progress: SyncProgress.createSyncProgress({ ...previous.progress, isConnected: false }),
      protocolVersion: ProtocolVersion.ProtocolVersion(previous.protocolVersion),
      ...(previous.legacyTxHistory === undefined ? {} : { legacyTxHistory: previous.legacyTxHistory }),
    };
  },

  /**
   * Finishes a crossing at the first sync update: the reservations released, then the coin hashes computed.
   *
   * @remarks
   *   The other half of {@link CoreWallet.fromPreviousVersion}. A migrated wallet arrives holding its whole local state
   *   but nothing it needs the secret keys for — no commitments or nullifiers, and no way to un-book the spends it
   *   carried — because a migration is by design handed no key material. The first sync update carries it, so this is
   *   where both gaps close: {@link releaseStrandedSpends} first, since a released coin is one more coin the hashes have
   *   to name, and {@link CoreWallet.resolveCoinHashes} over the state that comes back. Applied at the head of both sync
   *   capabilities, before anything else they do, so a batch that turns out to be empty still runs it: a wallet that
   *   crossed into a quiet timeline must not be left unable to name or to spend the coins it crossed with.
   *
   *   Idempotent and self-clearing: without the marker this is the identity, so it costs a field read on every update
   *   thereafter and nothing else. That is also what keeps it away from a reservation made on this side of the
   *   boundary, whose transaction is live and whose coins are genuinely spoken for.
   * @param wallet The wallet to complete.
   * @param secretKeys The keys the update arrived with.
   * @returns `wallet` unchanged if it never crossed, otherwise a copy whose coins are nameable and spendable again.
   */
  completeCrossing(wallet: CoreWallet, secretKeys: ledger.ZswapSecretKeys): CoreWallet {
    return wallet.coinHashesPending === undefined
      ? wallet
      : CoreWallet.resolveCoinHashes({ ...wallet, state: releaseStrandedSpends(wallet.state, secretKeys) }, secretKeys);
  },

  /**
   * Computes the coin hashes a wallet crossed the ledger-version boundary without.
   *
   * @remarks
   *   The hash half of {@link CoreWallet.completeCrossing}, which is what the sync capabilities call: a crossing has a
   *   second gap to close beside this one, so a caller finishing one should go through the combined step rather than
   *   here. A migrated wallet arrives holding its whole local state but no commitments or nullifiers for it, because
   *   deriving those needs the secret keys, and the first sync update is what carries them.
   *
   *   Idempotent and self-clearing: without the marker this is the identity.
   * @param wallet The wallet to complete.
   * @param secretKeys The keys the update arrived with.
   * @returns `wallet` unchanged if its hashes were never pending, otherwise a copy holding them.
   */
  resolveCoinHashes(wallet: CoreWallet, secretKeys: ledger.ZswapSecretKeys): CoreWallet {
    if (wallet.coinHashesPending === undefined) return wallet;
    // Rebuilt by spread rather than from a list of fields, so nothing the wallet carried can be left behind: only the
    // marker is shed, and the embedded transaction history of a 1.0.0 snapshot survives the first update after crossing.
    const { coinHashesPending: _pending, ...carried } = wallet;
    return { ...carried, coinHashes: CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(wallet.state)) };
  },

  applyCollapsedUpdate(wallet: CoreWallet, collapsed: ledger.MerkleTreeCollapsedUpdate): CoreWallet {
    const newState = wallet.state.applyCollapsedUpdate(collapsed);
    return { ...wallet, state: newState };
  },

  apply<TOffer extends ledger.ZswapOffer<ledger.Proofish>>(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    offer: TOffer,
  ): CoreWallet {
    const newState = wallet.state.apply(secretKeys, offer);
    const newCoinHashes = CoinHashesMap.updateWithCoins(
      secretKeys,
      wallet.coinHashes,
      CoinHashesMap.pickAllCoins(newState),
    );
    return { ...wallet, state: newState, coinHashes: newCoinHashes };
  },

  replayEventsWithChanges(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    events: ledger.Event[],
  ): [CoreWallet, ledger.ZswapStateChanges[]] {
    const stateWithChanges = wallet.state.replayEventsWithChanges(secretKeys, events);
    const newState = stateWithChanges.state;
    const newCoinHashes = CoinHashesMap.updateWithCoins(
      secretKeys,
      wallet.coinHashes,
      CoinHashesMap.pickAllCoins(newState),
    );

    const updatedWallet = { ...wallet, state: newState, coinHashes: newCoinHashes };

    return [updatedWallet, stateWithChanges.changes];
  },

  updateProgress(
    wallet: CoreWallet,
    {
      appliedIndex,
      highestRelevantWalletIndex,
      highestIndex,
      highestRelevantIndex,
      isConnected,
    }: Partial<SyncProgress.SyncProgressData>,
  ): CoreWallet {
    const updatedProgress = SyncProgress.createSyncProgress({
      appliedIndex: appliedIndex ?? wallet.progress.appliedIndex,
      highestRelevantWalletIndex: highestRelevantWalletIndex ?? wallet.progress.highestRelevantWalletIndex,
      highestIndex: highestIndex ?? wallet.progress.highestIndex,
      highestRelevantIndex: highestRelevantIndex ?? wallet.progress.highestRelevantIndex,
      isConnected: isConnected ?? wallet.progress.isConnected,
    });
    return { ...wallet, progress: updatedProgress };
  },

  // TODO: Remove after tx history is implemented
  addTransaction(wallet: CoreWallet, _tx: ledger.FinalizedTransaction): CoreWallet {
    return wallet;
  },

  /**
   * Un-books the coins a transaction spent, and forgets what the wallet recorded about those bookings.
   *
   * @remarks
   *   Forgetting matters as much as un-booking: a coin booked again afterwards is booked for a different transaction, and
   *   must be measured by that transaction's TTL and by when sync first sees the new booking, rather than inherit the
   *   deadline of the one reverted here.
   * @param wallet The wallet holding the bookings.
   * @param tx The transaction the coins were booked for.
   * @returns The wallet with the transaction's coins no longer booked.
   */
  revertTransaction<TTx extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>>(
    wallet: CoreWallet,
    tx: TTx,
  ): CoreWallet {
    const state = wallet.state.revertTransaction(tx);
    const stillBooked = bookedNonces(state);
    const bookings: Record<ledger.Nonce, Booking> = Object.fromEntries(
      Object.entries(wallet.bookings ?? {}).filter(([nonce]) => stillBooked.has(nonce)),
    );

    return withBookings({ ...wallet, state }, bookings);
  },

  /**
   * Un-books only the coins a transaction spent in the fallible segments that failed, and forgets those bookings.
   *
   * @remarks
   *   A transaction that lands as a partial success had its guaranteed section and its successful fallible segments
   *   applied on chain, so the coins those spent are gone and sync settles them; they stay booked here. Only the coins
   *   spent in a failed segment's fallible offer were never spent, so only those become available again. A segment id
   *   with no fallible offer in `tx` has nothing to release and is ignored. The bookings of the released coins are
   *   forgotten for the same reason as in {@link CoreWallet.revertTransaction}.
   * @example
   *   const released = CoreWallet.revertFailedSegments(wallet, tx, [1]);
   *
   * @param wallet The wallet holding the bookings.
   * @param tx The transaction the coins were booked for.
   * @param failedSegments The ids of the fallible segments the chain did not apply.
   * @returns The wallet with the coins of the failed segments no longer booked, and every other booking kept.
   */
  revertFailedSegments<TTx extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>>(
    wallet: CoreWallet,
    tx: TTx,
    failedSegments: ReadonlyArray<number>,
  ): CoreWallet {
    const failedOffers = Arr.filterMap(failedSegments, (segmentId) =>
      Option.fromNullable(tx.fallibleOffer?.get(segmentId)),
    );
    const state = Arr.reduce(failedOffers, wallet.state, (released, offer) => released.applyFailed(offer));
    const stillBooked = bookedNonces(state);
    const bookings: Record<ledger.Nonce, Booking> = Object.fromEntries(
      Object.entries(wallet.bookings ?? {}).filter(([nonce]) => stillBooked.has(nonce)),
    );

    return withBookings({ ...wallet, state }, bookings);
  },

  /**
   * Releases every booking whose deadline has passed, and records `now` as when sync first saw every booking it had not
   * seen before.
   *
   * @remarks
   *   A transaction that is abandoned, or never included, leaves its coins booked with nothing to settle them, and the
   *   booking is saved with the wallet, so without this the coins would stay locked for good. A booking's deadline is
   *   {@link bookingDeadline}: its transaction's TTL or a full lifetime after it was first seen here, whichever comes
   *   first. First-seen is taken here rather than when the coin is booked, so it is read off the same clock it is later
   *   checked against; a booking restored from a snapshot that recorded none is treated the same way, so it is never
   *   given less than its due. A booking is released strictly after its deadline, never at it: a spend is valid up to
   *   and including it.
   *
   *   Releasing needs `secretKeys`, because un-booking a spend means re-deriving it; without them, first sightings are
   *   still recorded and nothing is released. Only coins still booked keep an entry in `bookings`. Returns the wallet
   *   it was given when nothing changed, so a caller that publishes on change does not publish on every sweep.
   * @param wallet The wallet to sweep. The caller decides when it is safe to: only once sync has caught up.
   * @param secretKeys The keys a sync update carried, if it carried any.
   * @param now The instant to expire against.
   * @returns The wallet with expired bookings released and every remaining booking's first sighting recorded.
   */
  expireBookings(wallet: CoreWallet, secretKeys: ledger.ZswapSecretKeys | undefined, now: Date): CoreWallet {
    const known = wallet.bookings ?? {};
    const dated = [...wallet.state.pendingSpends.values()].map(([coin]) => {
      const recorded = known[coin.nonce];
      const seen = recorded?.seen ?? now;
      return { coin, booking: { ...recorded, seen }, deadline: bookingDeadline(seen, recorded?.ttl) };
    });
    const expired = secretKeys === undefined ? [] : dated.filter(({ deadline }) => deadline.getTime() < now.getTime());
    const state =
      expired.length === 0 || secretKeys === undefined
        ? wallet.state
        : releaseSpends(
            wallet.state,
            secretKeys,
            expired.map(({ coin }) => coin),
          );
    const stillBooked = bookedNonces(state);
    const bookings: Record<ledger.Nonce, Booking> = Object.fromEntries(
      dated.filter(({ coin }) => stillBooked.has(coin.nonce)).map(({ coin, booking }) => [coin.nonce, booking]),
    );

    const sameTime = (a: Date | undefined, b: Date | undefined): boolean => a?.getTime() === b?.getTime();
    const unchanged =
      state === wallet.state &&
      Object.keys(bookings).length === Object.keys(known).length &&
      Object.entries(bookings).every(
        ([nonce, booking]) => sameTime(known[nonce]?.seen, booking.seen) && sameTime(known[nonce]?.ttl, booking.ttl),
      );

    return unchanged ? wallet : withBookings({ ...wallet, state }, bookings);
  },

  // TODO: Remove after tx history is implemented
  updateTxHistory(wallet: CoreWallet, _newTxs: readonly ledger.FinalizedTransaction[]): CoreWallet {
    return wallet;
  },

  /**
   * Books `coins` for a transaction and builds an input offer spending each.
   *
   * @param wallet The wallet holding the coins.
   * @param secretKeys The keys that spend them.
   * @param coins The coins to book.
   * @param segment The transaction segment the inputs go into.
   * @param ttl The TTL of the transaction the coins are booked for, if it has one. The wallet records it in `bookings`
   *   against each coin, because the ledger accepts it here but does not keep it, so the coin is held no longer than
   *   the transaction can be included (see {@link bookingDeadline}). With no TTL nothing is recorded yet: the sweep
   *   records when it first sees the booking.
   * @returns One input offer per coin, and the wallet holding the bookings.
   */
  spendCoins(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    coins: ReadonlyArray<ledger.QualifiedShieldedCoinInfo>,
    segment: number,
    ttl?: Date,
  ): [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, CoreWallet] {
    const [offers, newLocalState] = pipe(
      coins,
      Arr.reduce(
        [[], wallet.state] as [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, ledger.ZswapLocalState],
        ([accOffers, localState], coinToSpend) => {
          const [nextState, newInput] = localState.spend(secretKeys, coinToSpend, segment, ttl);
          const inputOffer = ledger.ZswapOffer.fromInput(newInput, coinToSpend.type, coinToSpend.value);
          return [accOffers.concat([inputOffer]), nextState] as [
            ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>,
            ledger.ZswapLocalState,
          ];
        },
      ),
    );
    const updated: CoreWallet =
      ttl === undefined
        ? { ...wallet, state: newLocalState }
        : withBookings(
            { ...wallet, state: newLocalState },
            {
              ...wallet.bookings,
              ...Object.fromEntries(coins.map((coin): [ledger.Nonce, Booking] => [coin.nonce, { ttl }])),
            },
          );
    return [offers, updated];
  },

  watchCoins(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    coins: ReadonlyArray<ledger.ShieldedCoinInfo>,
  ): CoreWallet {
    const newLocalState = coins.reduce(
      (localState: ledger.ZswapLocalState, coin) => localState.watchFor(wallet.publicKeys.coinPublicKey, coin),
      wallet.state,
    );
    const newCoinHashes = CoinHashesMap.updateWithNewCoins(secretKeys, wallet.coinHashes, coins);
    return { ...wallet, state: newLocalState, coinHashes: newCoinHashes };
  },
};
