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
 * What a shielded wallet releases when a transaction it balanced lands as a partial success.
 *
 * @remarks
 *   The chain applied the guaranteed segment and failed a fallible one. The coins the guaranteed segment spent are gone,
 *   so they stay booked until sync settles them; the coins the failed segment would have spent were never spent, so
 *   they must be spendable again. Asserted through the wallet's own API — the call an application makes and the state
 *   it reads — on each variant, because each one reaches the release by its own path.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { type AnyTx, NetworkId, ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { type WalletRuntimeError } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { V8, V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, type Scope } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type ShieldedWalletState } from '../ShieldedWalletAPI.js';
import { type ForkWallet, makeForkWallet } from './forkHarness.js';
import { type MintedCoin, makePayingV9Chain, mintable, v8Payment } from './translationStub.js';
import { totalValue } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain past the boundary. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);
/** A chain below it. */
const v8Version = ProtocolVersion.ProtocolVersion(5n);

const forkBlock = 4n;

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

/**
 * The wallet's two coins, and what each segment of the transaction pays out.
 *
 * @remarks
 *   Coin selection takes the smallest coin that covers a shortfall, and balances the fallible segments before the
 *   guaranteed one. So the fallible segment's 50 is covered by the 100 coin, and the guaranteed segment's 150 can then
 *   only be covered by the 200 coin: each segment spends exactly one coin, and which one is fixed.
 */
const fallibleCoinValue = 100n;
const guaranteedCoinValue = 200n;
const walletTotal = fallibleCoinValue + guaranteedCoinValue;
const fallibleAmount = 50n;
const guaranteedAmount = 150n;
const fallibleSegment = 1;

const walletRecipient = () => {
  const keys = ledgerV9.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const chainCoins = (): readonly MintedCoin[] =>
  [fallibleCoinValue, guaranteedCoinValue].map((value) =>
    mintable(ledgerV8.shieldedToken().raw, value, walletRecipient()),
  );

/** A ledger-v8 chain stamped with `version` from its genesis block, paying the wallet one coin per block. */
const chainAt = (version: ProtocolVersion.ProtocolVersion, coins: readonly MintedCoin[]) =>
  Effect.gen(function* () {
    const chain = yield* V8.Simulator.init({
      networkId,
      protocolVersion: version,
      blockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
    });
    yield* Effect.forEach(coins, (coin) => chain.submitTransaction(v8Payment(networkId, coin)), { discard: true });
    return chain;
  });

/** The ledger-v9 source: a chain that simply pays the wallet these coins. */
const payingChainFor = (coins: readonly MintedCoin[], chain: V8.Simulator) =>
  Effect.gen(function* () {
    const genesisTime = yield* chain.query((state) => state.currentTime);
    return yield* makePayingV9Chain({
      networkId,
      protocolVersion: v9Version,
      genesisBlockNumber: forkBlock,
      genesisTime,
      blockProducer: V9.immediateBlockProducer(undefined, V9.genesisStrictness),
      coins,
    });
  });

/** A wallet synchronized on the variant that owns `version`, holding both coins. Scoped: the caller's scope stops it. */
const syncedWallet = (
  version: ProtocolVersion.ProtocolVersion,
): Effect.Effect<ForkWallet, LedgerOps.LedgerError | WalletRuntimeError, Scope.Scope> =>
  Effect.gen(function* () {
    const coins = chainCoins();
    const chain = yield* chainAt(version, coins);
    const v9 = yield* payingChainFor(coins, chain);

    const wallet = yield* makeForkWallet({ v8: chain, v9: Effect.succeed(v9), networkId, forkVersion, seed });
    yield* Effect.addFinalizer(() => wallet.stop);
    yield* wallet.start;

    yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
    return wallet;
  });

/** A transaction paying a stranger out of nothing in its guaranteed segment and in fallible segment 1. */
const v8TwoSegmentPayment = (): AnyTx => {
  const stranger = ledgerV8.ZswapSecretKeys.fromSeed(otherSeed);
  const offerOf = (value: bigint) => {
    const coin = ledgerV8.createShieldedCoinInfo(ledgerV8.shieldedToken().raw, value);
    const output = ledgerV8.ZswapOutput.new(coin, 0, stranger.coinPublicKey, stranger.encryptionPublicKey);
    return ledgerV8.ZswapOffer.fromOutput(output, coin.type, coin.value);
  };
  const tx = ledgerV8.Transaction.fromParts(networkId, offerOf(guaranteedAmount)).addZswapOffer(
    { tag: 'specific', value: fallibleSegment },
    offerOf(fallibleAmount),
  );
  return WalletTransaction.adopt('Unproven', tx, v8Version);
};

/** The ledger-v9 twin of {@link v8TwoSegmentPayment}. */
const v9TwoSegmentPayment = (): AnyTx => {
  const stranger = ledgerV9.ZswapSecretKeys.fromSeed(otherSeed);
  const offerOf = (value: bigint) => {
    const coin = ledgerV9.createShieldedCoinInfo(ledgerV9.shieldedToken().raw, value);
    const output = ledgerV9.ZswapOutput.new(coin, 0, stranger.coinPublicKey, stranger.encryptionPublicKey);
    return ledgerV9.ZswapOffer.fromOutput(output, coin.type, coin.value);
  };
  const tx = ledgerV9.Transaction.fromParts(networkId, offerOf(guaranteedAmount)).addZswapOffer(
    { tag: 'specific', value: fallibleSegment },
    offerOf(fallibleAmount),
  );
  return WalletTransaction.adopt('Unproven', tx, forkVersion);
};

/** The values of the coins the wallet's public state reports as spendable, ascending. */
const availableValues = (state: ShieldedWalletState): readonly bigint[] =>
  state.availableCoins
    .map(({ coin }) => coin.value)
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));

/** The latest state the wallet publishes. */
const latestState = (wallet: ForkWallet): Promise<ShieldedWalletState> => rx.firstValueFrom(wallet.shielded.state);

describe('a shielded wallet reverting the failed segments of a transaction it balanced', () => {
  describe.each([
    ['V1', v8Version, V1Tag, v8TwoSegmentPayment],
    ['V2', v9Version, V2Tag, v9TwoSegmentPayment],
  ] as const)('on the %s variant', (_variant, chainVersion, expectedTag, twoSegmentPayment) => {
    it('should make the failed fallible segment’s coin spendable again and keep the guaranteed segment’s coin booked, because only the failed segment was never spent', async () =>
      Effect.gen(function* () {
        const wallet = yield* syncedWallet(chainVersion);
        expect(yield* wallet.activeTag).toBe(expectedTag);

        // Absent only if there were nothing to balance, which would leave nothing booked to release.
        const balancing = yield* Effect.promise(() => wallet.shielded.balanceTransaction(twoSegmentPayment())).pipe(
          Effect.flatMap(Effect.fromNullable),
        );

        // Both coins are booked by the balancing: nothing is spendable until the transaction's fate is known.
        yield* Effect.promise(() =>
          vi.waitFor(async () => expect(availableValues(await latestState(wallet))).toEqual([])),
        );

        yield* Effect.promise(() => wallet.shielded.revertFailedSegments(balancing, [fallibleSegment]));

        // The fallible segment's coin is back; the guaranteed segment's coin, which the chain did spend, is not.
        yield* Effect.promise(() =>
          vi.waitFor(async () => expect(availableValues(await latestState(wallet))).toEqual([fallibleCoinValue])),
        );
        expect(yield* wallet.activeTag).toBe(expectedTag);
      }).pipe(Effect.scoped, Effect.runPromise));
  });
});
