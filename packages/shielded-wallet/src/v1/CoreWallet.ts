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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { ProtocolVersion, SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either, Iterable, pipe, Record, Array as Arr } from 'effect';
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
   * The transaction history that a 1.0.0 snapshot embedded, as the hex-encoded proven ledger transactions it was
   * written with. Carried across a restore and written back out untouched, so upgrading does not destroy it; this SDK
   * keeps history in its own storage and never reads or adds to this list.
   *
   * Absent for every snapshot written since the field was dropped from the schema, and absent means absent — it is not
   * written back as an empty list, so those snapshots keep the bytes they had.
   */
  legacyTxHistory?: readonly string[];
  /**
   * The V2 variant's mid-crossing marker, when a snapshot this variant was handed happened to carry one.
   *
   * This variant has no such state: it never crosses into itself, so it neither sets this nor reads it. It is kept only
   * so that reading such a snapshot and writing it back does not quietly discard the field — the same reason
   * {@link legacyTxHistory} is kept, and the same failure it exists to prevent. `Restore.ts` routes a snapshot to the
   * variant that owns its `protocolVersion`, so in a build registering both twins this is never populated; it is the
   * reader's promise not to lose what it cannot represent, not a state this variant can be in.
   */
  foreignCoinHashesPending?: true;
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
}>;

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
 * How long a booking may stand before the wallet releases it: the ledger's default `global_ttl`.
 *
 * @remarks
 *   A shielded input is valid only while the Merkle root it was proven against is still in the chain's root history, and
 *   that history drops roots older than `global_ttl`, so no shielded spend can be included later than this after it was
 *   built. A transaction's own TTL can only be shorter.
 */
export const BOOKING_LIFETIME_MS = 60 * 60 * 1000;

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
 *   bookingDeadline(new Date('2026-10-08T12:00:00Z'), undefined); // 13:00
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
    foreignCoinHashesPending?: true,
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
          ...(foreignCoinHashesPending === undefined ? {} : { foreignCoinHashesPending }),
        }),
      }),
    );
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
   * Projects a wallet inherited from the previous ledger version onto a fresh state of this one.
   *
   * @remarks
   *   No coin data crosses the boundary here, and that is a decision rather than an oversight. This is the oldest variant
   *   the wallet registers and no ledger version below it exists, so nothing ever hands a state to this projection: it
   *   is shape parity with the twin at `src/v2`, which is the variant a real crossing lands in. That twin adopts the
   *   previous wallet's local state whole, by deserializing its bytes — the two ledger majors share the
   *   `zswap-local-state` codec — because the chain's state translation continues the commitment tree across the fork
   *   and the indexer re-emits none of the ledger-v8 timeline (see `src/v2/Migration.ts`). Mirroring that into a seam
   *   no chain can reach would buy nothing, so this side stays as it is.
   *
   *   What crosses is therefore identity and position: the public keys — which decide whose coins the far side can
   *   decrypt — the network, the protocol version that triggered the hand-over, kept so the new variant starts inside
   *   its own activation range rather than immediately signalling backwards, and the cursor the previous variant
   *   stopped at.
   *
   *   **Sync progress is parked at the fork, not rewound**: the previous wallet's cursor crosses unchanged. A fork does
   *   not restart the timeline — event ids run onwards from whatever the indexer had reached when it happened, never
   *   from zero — so resuming from the inherited cursor is what puts this wallet in front of what comes next. Rewinding
   *   to zero would park it on a stretch of history that this ledger version's events do not occupy. What does not
   *   cross is `isConnected`: no sync is running behind this state yet.
   *
   *   Coin hashes start empty for the same reason the tree does: they are commitments and nullifiers computed under the
   *   previous ledger's codec, and this version recomputes its own from the keys and whatever state it ends up with.
   * @param previous The plain data read off the previous ledger version's wallet.
   * @returns A wallet of this ledger version holding no coins, positioned at the fork.
   */
  fromPreviousVersion(previous: {
    readonly publicKeys: PublicKeys;
    readonly networkId: string;
    readonly protocolVersion: bigint;
    readonly progress: SyncProgress.SyncProgressData;
  }): CoreWallet {
    return {
      state: new ledger.ZswapLocalState(),
      publicKeys: previous.publicKeys,
      networkId: previous.networkId,
      coinHashes: CoinHashesMap.empty,
      progress: SyncProgress.createSyncProgress({ ...previous.progress, isConnected: false }),
      protocolVersion: ProtocolVersion.ProtocolVersion(previous.protocolVersion),
    };
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
