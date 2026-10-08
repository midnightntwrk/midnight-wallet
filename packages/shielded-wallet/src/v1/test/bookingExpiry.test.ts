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
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { pipe } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { VersionSignalSyncUpdate, WalletSyncUpdate, makeEventsSyncCapability } from '../Sync.js';

const networkId = NetworkId.NetworkId.Undeployed;
const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 5));
const activeRange = ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion);

/** The ledger's default `global_ttl`: the longest a shielded spend can stay valid after it is built. */
const LIFETIME_MS = 60 * 60 * 1000;
const bookedAt = new Date('2026-10-08T12:00:00Z');
const after = (ms: number): Date => new Date(bookedAt.getTime() + ms);

const coinsAndBalances = makeDefaultCoinsAndBalancesCapability();
const serialization = makeDefaultV1SerializationCapability();

// The sweep reads the system clock, so the system clock is what each step pins. Only `Date` is faked: nothing here
// waits on a timer.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Applies an update that carries no events, as a caught-up wallet receives on a quiet chain, at `now`. */
const syncAt = (wallet: CoreWallet, now: Date): CoreWallet => {
  vi.setSystemTime(now);
  const [state] = makeEventsSyncCapability().applyUpdate(wallet, WalletSyncUpdate.create([], keys()), activeRange);
  return state;
};

/**
 * Applies the periodic version check at `now` as the source delivers it: the signal, reporting the tip the wallet has
 * already reached, then the empty batch that follows it. On a chain with no shielded traffic these are the only updates
 * a caught-up wallet receives.
 */
const versionCheckAt = (wallet: CoreWallet, now: Date): CoreWallet => {
  vi.setSystemTime(now);
  const capability = makeEventsSyncCapability();
  const [signalled] = capability.applyUpdate(
    wallet,
    VersionSignalSyncUpdate.create(Number(wallet.protocolVersion), Number(wallet.progress.appliedIndex)),
    activeRange,
  );
  const [state] = capability.applyUpdate(signalled, WalletSyncUpdate.create([], keys()), activeRange);
  return state;
};

const caughtUp = (wallet: CoreWallet): CoreWallet =>
  CoreWallet.updateProgress(wallet, { appliedIndex: 100n, highestRelevantWalletIndex: 100n, isConnected: true });

const behind = (wallet: CoreWallet): CoreWallet =>
  CoreWallet.updateProgress(wallet, { appliedIndex: 10n, highestRelevantWalletIndex: 100n, isConnected: true });

/** A caught-up wallet holding one coin, which it has booked for a transaction it then abandoned. */
const walletWithAbandonedBooking = (): CoreWallet => {
  const mine = keys();
  const coin = ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, 500n);
  const output = ledger.ZswapOutput.new(coin, 0, mine.coinPublicKey, mine.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, coin.type, coin.value);
  const settled = caughtUp(CoreWallet.init(new ledger.ZswapLocalState().apply(mine, offer), mine, networkId));
  return pipe(CoreWallet.spendCoins(settled, mine, [[...settled.state.coins][0]], 0), ([, booked]) => booked);
};

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

  it('should be released by the periodic version check alone, so a chain with no shielded traffic still frees the coin', () => {
    const seen = versionCheckAt(walletWithAbandonedBooking(), bookedAt);
    expect(isBooked(seen)).toBe(true);

    expect(isReleased(versionCheckAt(seen, after(LIFETIME_MS + 1)))).toBe(true);
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
