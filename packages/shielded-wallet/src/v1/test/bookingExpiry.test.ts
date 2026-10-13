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
 * What releases a coin booked for a transaction that is never submitted, or never included.
 *
 * @remarks
 *   Booking a coin moves it into the ledger's `pendingSpends`, which is saved with the rest of the wallet's state, so a
 *   booking outlives the process that made it. Inclusion clears it and so does an explicit revert, but a transaction
 *   that is simply abandoned, or that never lands, has neither, and the ledger's own expiry (`clearPending`) does
 *   nothing. The wallet therefore expires its bookings itself, the same way the unshielded wallet does, so a wallet
 *   used without the facade is covered too.
 *
 *   A shielded spend cannot outlive the chain's `global_ttl`: an input is valid only while the Merkle root it was proven
 *   against is still in the chain's root history, and that history drops roots older than `global_ttl`. So a booking is
 *   given that lifetime, counted from the first sync update that sees it, and released strictly after it has passed —
 *   and only once sync has caught up, because while a replay is running a booked coin may already have been spent by a
 *   transaction the replay has not delivered yet.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  BlockHash,
  ZswapEventTip,
  ZswapEvents,
  type BlockHashQuery,
  type ZswapEventTipSubscription,
  type ZswapEventsSubscription,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type ClientError, type ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Duration, Effect, Fiber, pipe, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { WalletSyncUpdate, makeEventsSyncCapability, makeEventsSyncService } from '../Sync.js';

const networkId = NetworkId.NetworkId.Undeployed;
const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 5));
const activeRange = ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion);

/** The ledger's default `global_ttl`: the longest a shielded spend can stay valid after it is built. */
const LIFETIME_MS = 60 * 60 * 1000;
const bookedAt = new Date('2026-10-08T12:00:00Z');
const after = (ms: number): Date => new Date(bookedAt.getTime() + ms);

const coinsAndBalances = makeDefaultCoinsAndBalancesCapability();
const serialization = makeDefaultV1SerializationCapability();

/**
 * Applies an update that carries no events, as a caught-up wallet receives on a quiet chain, stamped by its source at
 * `now`. The stamp is the only clock the sweep reads, so nothing here touches the machine's clock.
 */
const syncAt = (wallet: CoreWallet, now: Date): CoreWallet => {
  const [state] = makeEventsSyncCapability().applyUpdate(wallet, WalletSyncUpdate.create([], keys(), now), activeRange);
  return state;
};

/** How often the indexer source sends its heartbeat, with or without anything to report. */
const WATCH_INTERVAL_MS = 30_000;

/** A tip block as the indexer serves it, reported at `protocolVersion`, with the rest filled in. */
const tipAt = (protocolVersion: number): BlockHashQuery => ({
  block: {
    height: 100,
    hash: '0xabc',
    protocolVersion,
    ledgerParameters: '0x00',
    timestamp: 1_700_000_000,
    zswapEndIndex: 100,
    dustCommitmentEndIndex: 0,
    dustGenerationEndIndex: 0,
    dustCommitmentMerkleTreeRoot: null,
    dustGenerationMerkleTreeRoot: null,
  },
});

/** An event subscription that stays open and never pushes anything: a chain with no shielded traffic. */
const quietChain = (): Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient> =>
  Stream.never;

const eventTip = (): Stream.Stream<ZswapEventTipSubscription, ClientError | ServerError, SubscriptionClient> =>
  Stream.make({ zswapLedgerEvents: { id: 100, maxId: 100 } });

/**
 * Runs the indexer source against a quiet chain whose tip is on the wallet's own protocol version, folding everything
 * it emits into the wallet, for `elapsedMs` of test-clock time.
 */
const runOnQuietChain = (wallet: CoreWallet, elapsedMs: number): Promise<CoreWallet> => {
  const capability = makeEventsSyncCapability();
  const source = makeEventsSyncService({
    indexerClientConnection: {
      indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    },
    batchUpdates: { size: 100, timeout: 60_000, spacing: 0 },
    versionWatch: { intervalMs: WATCH_INTERVAL_MS },
  });

  return pipe(
    source.updates(wallet, keys()),
    Stream.interruptAfter(Duration.millis(elapsedMs)),
    Stream.runFold(wallet, (state, update) => capability.applyUpdate(state, update, activeRange)[0]),
    Effect.provideService(BlockHash.tag, () => Effect.succeed(tipAt(Number(wallet.protocolVersion)))),
    Effect.provideService(ZswapEventTip.tag, eventTip),
    Effect.provideService(ZswapEvents.tag, quietChain),
    Effect.scoped,
    Effect.fork,
    // The test clock only moves when told to, and the run above only ends when it has moved far enough.
    Effect.tap(() => TestClock.adjust(Duration.millis(elapsedMs + WATCH_INTERVAL_MS))),
    Effect.flatMap(Fiber.join),
    Effect.provide(TestContext.TestContext),
    Effect.runPromise,
  );
};

const caughtUp = (wallet: CoreWallet): CoreWallet =>
  CoreWallet.updateProgress(wallet, { appliedIndex: 100n, highestRelevantWalletIndex: 100n, isConnected: true });

const behind = (wallet: CoreWallet): CoreWallet =>
  CoreWallet.updateProgress(wallet, { appliedIndex: 10n, highestRelevantWalletIndex: 100n, isConnected: true });

/** A caught-up wallet holding one coin, nothing booked. */
const walletWithOneCoin = (): CoreWallet => {
  const mine = keys();
  const coin = ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, 500n);
  const output = ledger.ZswapOutput.new(coin, 0, mine.coinPublicKey, mine.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, coin.type, coin.value);
  return caughtUp(CoreWallet.init(new ledger.ZswapLocalState().apply(mine, offer), mine, networkId));
};

/**
 * Books the wallet's one coin for a transaction, with the transaction's TTL when it has one.
 *
 * @returns The transaction the coin was booked for, and the wallet holding the booking.
 */
const book = (wallet: CoreWallet, ttl?: Date): [ledger.UnprovenTransaction, CoreWallet] => {
  const [offers, booked] = CoreWallet.spendCoins(wallet, keys(), [[...wallet.state.coins][0]], 0, ttl);
  return [ledger.Transaction.fromParts(networkId, offers[0]), booked];
};

/** A caught-up wallet holding one coin, which it has booked for a transaction it then abandoned. */
const walletWithAbandonedBooking = (ttl?: Date): CoreWallet => pipe(book(walletWithOneCoin(), ttl), ([, w]) => w);

const restarted = (wallet: CoreWallet): CoreWallet =>
  caughtUp(EitherOps.getOrThrowLeft(serialization.deserialize(null, serialization.serialize(wallet))));

const isBooked = (wallet: CoreWallet): boolean =>
  wallet.state.pendingSpends.size === 1 && coinsAndBalances.getAvailableCoins(wallet).length === 0;

const isReleased = (wallet: CoreWallet): boolean =>
  wallet.state.pendingSpends.size === 0 && coinsAndBalances.getAvailableCoins(wallet).length === 1;

describe('A shielded booking nothing ever settles', () => {
  it('should be released once its lifetime has passed, so an abandoned transaction does not lock the coin for good', () => {
    const seen = syncAt(walletWithAbandonedBooking(), bookedAt);
    expect(isBooked(seen)).toBe(true);

    expect(isReleased(syncAt(seen, after(LIFETIME_MS + 1)))).toBe(true);
  });

  it("should be released by the source's heartbeat alone, so a chain with no shielded traffic and no new version still frees the coin", async () => {
    // The chain is already on the wallet's version and never pushes an event, so the source has neither a batch nor a
    // version to report: its heartbeat is the only update the wallet receives.
    const released = await runOnQuietChain(walletWithAbandonedBooking(), LIFETIME_MS + 4 * WATCH_INTERVAL_MS);

    expect(isReleased(released)).toBe(true);
  });

  it('should be expired against the time its update was stamped with, not the machine clock, so the source alone decides when a booking has lapsed', () => {
    // `bookedAt` lies days before any machine running this test: a sweep reading the machine's clock would first see
    // the booking now and still hold it an hour later in update time, while one reading the stamp releases it.
    const seen = syncAt(walletWithAbandonedBooking(), bookedAt);
    expect(isBooked(syncAt(seen, after(LIFETIME_MS)))).toBe(true);

    expect(isReleased(syncAt(seen, after(LIFETIME_MS + 1)))).toBe(true);
  });

  it('should be listed as reserved, with when it was first seen and when it will be released, so a stuck coin can be told apart', () => {
    const booked = walletWithAbandonedBooking();
    const [coin] = [...booked.state.coins];
    expect(coinsAndBalances.getReservedCoins(booked)).toEqual([
      expect.objectContaining({ coin, reservedSince: undefined, releasableAfter: undefined }),
    ]);

    const seen = syncAt(booked, bookedAt);
    expect(coinsAndBalances.getReservedCoins(seen)).toEqual([
      expect.objectContaining({ coin, reservedSince: bookedAt, releasableAfter: after(LIFETIME_MS) }),
    ]);

    expect(coinsAndBalances.getReservedCoins(syncAt(seen, after(LIFETIME_MS + 1)))).toEqual([]);
  });

  it('should still be booked at the instant its lifetime ends, because a spend is valid up to and including it', () => {
    const seen = syncAt(walletWithAbandonedBooking(), bookedAt);

    expect(isBooked(syncAt(seen, after(LIFETIME_MS)))).toBe(true);
  });

  it('should stay booked while sync is behind, because the replay may yet deliver the transaction that spent it', () => {
    const seen = syncAt(walletWithAbandonedBooking(), bookedAt);

    const replaying = syncAt(behind(seen), after(LIFETIME_MS + 1));
    expect(isBooked(replaying)).toBe(true);

    expect(isReleased(syncAt(caughtUp(replaying), after(LIFETIME_MS + 1)))).toBe(true);
  });

  it('should keep its expiry across a restart, so restarting does not extend how long the coin stays locked', () => {
    const seen = syncAt(walletWithAbandonedBooking(), bookedAt);

    expect(isReleased(syncAt(restarted(seen), after(LIFETIME_MS + 1)))).toBe(true);
  });

  it('should be given a full lifetime from the first update after loading when its snapshot recorded no expiry, so a coin is never released early', () => {
    // Written before any update saw the booking, which is also how every snapshot from before expiries were recorded
    // looks: the coin is in `pendingSpends` and nothing says when it was booked.
    const loaded = restarted(walletWithAbandonedBooking());
    const loadedAt = after(5 * LIFETIME_MS);

    const seen = syncAt(loaded, loadedAt);
    expect(isBooked(seen)).toBe(true);
    expect(isBooked(syncAt(seen, new Date(loadedAt.getTime() + LIFETIME_MS)))).toBe(true);

    expect(isReleased(syncAt(seen, new Date(loadedAt.getTime() + LIFETIME_MS + 1)))).toBe(true);
  });
});

describe('A shielded booking taken for a transaction with a TTL', () => {
  const ttl = after(10 * 60 * 1000);

  it('should be released once the TTL has passed, so a coin is not held for a transaction that can no longer be included', () => {
    const seen = syncAt(walletWithAbandonedBooking(ttl), bookedAt);

    expect(isReleased(syncAt(seen, new Date(ttl.getTime() + 1)))).toBe(true);
  });

  it('should still be booked at the instant its TTL ends, because the transaction is valid up to and including it', () => {
    const seen = syncAt(walletWithAbandonedBooking(ttl), bookedAt);

    expect(isBooked(syncAt(seen, ttl))).toBe(true);
  });

  it('should keep the full lifetime when the TTL lies beyond it, because no shielded spend outlives the lifetime anyway', () => {
    const seen = syncAt(walletWithAbandonedBooking(after(5 * LIFETIME_MS)), bookedAt);

    expect(isBooked(syncAt(seen, after(LIFETIME_MS)))).toBe(true);
    expect(isReleased(syncAt(seen, after(LIFETIME_MS + 1)))).toBe(true);
  });

  it('should be listed with when it was first seen and the TTL as when it will be released, so the reported deadline is the real one', () => {
    const booked = walletWithAbandonedBooking(ttl);
    const [coin] = [...booked.state.coins];

    expect(coinsAndBalances.getReservedCoins(syncAt(booked, bookedAt))).toEqual([
      expect.objectContaining({ coin, reservedSince: bookedAt, releasableAfter: ttl }),
    ]);
  });
});

describe('A shielded booking reverted and taken again', () => {
  it('should be given a full lifetime from when the new booking was first seen, so a coin re-booked for a fresh transaction is not released under it', () => {
    const [abandoned, booked] = book(walletWithOneCoin());
    const seen = syncAt(booked, bookedAt);

    const reverted = CoreWallet.revertTransaction(seen, abandoned);
    expect(isReleased(reverted)).toBe(true);

    const rebookedAt = after(LIFETIME_MS / 2);
    const [, rebooked] = book(reverted);
    const reseen = syncAt(rebooked, rebookedAt);

    expect(isBooked(syncAt(reseen, after(LIFETIME_MS + 1)))).toBe(true);
    expect(isBooked(syncAt(reseen, new Date(rebookedAt.getTime() + LIFETIME_MS)))).toBe(true);
    expect(isReleased(syncAt(reseen, new Date(rebookedAt.getTime() + LIFETIME_MS + 1)))).toBe(true);
  });

  it('should list the new booking as reserved since it was first seen, not since the reverted one was', () => {
    const [abandoned, booked] = book(walletWithOneCoin());
    const reverted = CoreWallet.revertTransaction(syncAt(booked, bookedAt), abandoned);

    const rebookedAt = after(LIFETIME_MS / 2);
    const [, rebooked] = book(reverted);
    const [coin] = [...rebooked.state.coins];

    expect(coinsAndBalances.getReservedCoins(syncAt(rebooked, rebookedAt))).toEqual([
      expect.objectContaining({
        coin,
        reservedSince: rebookedAt,
        releasableAfter: new Date(rebookedAt.getTime() + LIFETIME_MS),
      }),
    ]);
  });
});
