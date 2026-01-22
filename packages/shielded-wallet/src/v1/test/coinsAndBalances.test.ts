// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Record, Array, pipe } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability, type AvailableCoin, type PendingCoin } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';

type ShieldedTokenType = { tokenType: ledger.ShieldedTokenType; value: bigint };

const amountArbitrary = fc.bigInt({ min: 1n, max: 1000n });
const tokenTypeArbitrary = fc.constantFrom(ledger.shieldedToken(), {
  tag: 'shielded',
  raw: ledger.sampleRawTokenType(),
});
const coinArbitrary = fc.record({
  value: amountArbitrary,
  tokenType: tokenTypeArbitrary,
});

const toAvailableCoin = (c: ShieldedTokenType, secretKeys: ledger.ZswapSecretKeys): AvailableCoin => {
  const coin = ledger.createShieldedCoinInfo(c.tokenType.raw, BigInt(c.value));
  return {
    coin: { ...coin, mt_index: 0n },
    commitment: ledger.coinCommitment(coin, secretKeys.coinPublicKey),
    nullifier: ledger.coinNullifier(coin, secretKeys.coinSecretKey),
  };
};

const toPendingCoin = (c: ShieldedTokenType, secretKeys: ledger.ZswapSecretKeys): PendingCoin => {
  const coin = ledger.createShieldedCoinInfo(c.tokenType.raw, BigInt(c.value));
  return {
    coin,
    ttl: new Date(0),
    commitment: ledger.coinCommitment(coin, secretKeys.coinPublicKey),
    nullifier: ledger.coinNullifier(coin, secretKeys.coinSecretKey),
  };
};

const createInitialState = (secretKeys: ledger.ZswapSecretKeys, coins: AvailableCoin[]): ledger.ZswapLocalState => {
  const finalOffer = pipe(
    coins,
    Array.map(({ coin }) =>
      ledger.ZswapOffer.fromOutput(
        ledger.ZswapOutput.new(coin, 0, secretKeys.coinPublicKey, secretKeys.encryptionPublicKey),
        coin.type,
        coin.value,
      ),
    ),
    (offers) => (offers.length > 0 ? offers.reduce((acc, offer) => acc.merge(offer)) : undefined),
  );

  const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, finalOffer).eraseProofs();

  return tx.guaranteedOffer
    ? new ledger.ZswapLocalState().apply(secretKeys, tx.guaranteedOffer)
    : new ledger.ZswapLocalState();
};

const applyPendingCoinValues = (
  state: ledger.ZswapLocalState,
  secretKeys: ledger.ZswapSecretKeys,
  coins: PendingCoin[],
): ledger.ZswapLocalState =>
  pipe(
    coins,
    Array.reduce(state, (currentState, { coin }) => currentState.watchFor(secretKeys.coinPublicKey, coin)),
  );

const issueSpendingOfCoins = (
  state: ledger.ZswapLocalState,
  secretKeys: ledger.ZswapSecretKeys,
  coins: AvailableCoin[],
): ledger.ZswapLocalState =>
  pipe(
    coins,
    Array.reduce(state, (currentState, { coin }) => {
      const coinToSpend = [...currentState.coins].find(
        (c) => c.value === coin.value && c.type === coin.type && c.nonce === coin.nonce,
      );
      if (!coinToSpend) {
        throw new Error(`Could not find coin with value ${coin.value}n, type ${coin.type}, and nonce ${coin.nonce}`);
      }
      const [newLocalState, _] = currentState.spend(secretKeys, coinToSpend, 0);
      return newLocalState;
    }),
  );

function groupByTokenType<T extends AvailableCoin | PendingCoin>(coins: readonly T[]): Record<string, bigint[]> {
  return pipe(
    coins,
    Array.groupBy((c) => c.coin.type),
    Record.map((arr) => arr.map((c) => c.coin.value)),
    Record.map((arr) => arr.slice().sort((a, b) => Number(a - b))),
  );
}

describe('DefaultCoinsAndBalancesCapability', () => {
  it('should return correct balances and coins when wallet has no pending coins and no pending balances', () => {
    fc.assert(
      fc.property(fc.array(coinArbitrary), (coinInputs) => {
        const secretKeys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(1));
        const setupAvailableCoins: AvailableCoin[] = coinInputs.map((c) =>
          toAvailableCoin(c as { tokenType: { raw: string; tag: 'shielded' }; value: bigint }, secretKeys),
        );
        const networkId = NetworkId.NetworkId.Undeployed;
        const capability = makeDefaultCoinsAndBalancesCapability();

        const localState = createInitialState(secretKeys, setupAvailableCoins);
        const state = CoreWallet.init(localState, secretKeys, networkId);
        const pendingBalances = capability.getPendingBalances(state);
        const availableBalances = capability.getAvailableBalances(state);
        const totalBalances = capability.getTotalBalances(state);
        const pendingCoins = capability.getPendingCoins(state);
        const availableCoins = capability.getAvailableCoins(state);
        const totalCoins = capability.getTotalCoins(state);

        const availableCoinsbyType = groupByTokenType(availableCoins);
        Object.entries(availableCoinsbyType).forEach(([tokenType, values]) => {
          const sum = values.reduce((a, b) => a + b, 0n);
          expect(availableBalances[tokenType]).toEqual(sum);
          expect(totalBalances[tokenType]).toEqual(sum);
          expect(availableCoinsbyType[tokenType]).toEqual(values);
          expect(groupByTokenType(totalCoins)[tokenType]).toEqual(values);
        });

        expect(pendingBalances).toEqual({});
        expect(groupByTokenType(pendingCoins)).toEqual({});
      }),
      { numRuns: 10 },
    );
  });

  it('should return correct balances and coins when wallet has a pending coin and a pending balance', () => {
    fc.assert(
      fc.property(fc.array(coinArbitrary), fc.array(coinArbitrary), (fixtureAvailableCoins, fixturePendingCoins) => {
        const secretKeys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(1));
        const setupAvailableCoins: AvailableCoin[] = fixtureAvailableCoins.map((c) =>
          toAvailableCoin(c as ShieldedTokenType, secretKeys),
        );
        const setupPendingCoins: PendingCoin[] = fixturePendingCoins.map((c) =>
          toPendingCoin(c as ShieldedTokenType, secretKeys),
        );
        const networkId = NetworkId.NetworkId.Undeployed;
        const capability = makeDefaultCoinsAndBalancesCapability();

        let localState = createInitialState(secretKeys, setupAvailableCoins);
        localState = applyPendingCoinValues(localState, secretKeys, setupPendingCoins);
        const state = CoreWallet.init(localState, secretKeys, networkId);
        const availableBalances = capability.getAvailableBalances(state);
        const pendingBalances = capability.getPendingBalances(state);
        const totalBalances = capability.getTotalBalances(state);
        const availableCoins = capability.getAvailableCoins(state);
        const pendingCoins = capability.getPendingCoins(state);
        const totalCoins = capability.getTotalCoins(state);

        const byTypeAvailable = groupByTokenType(availableCoins);
        const byTypePending = groupByTokenType(pendingCoins);
        const byTypeTotal = groupByTokenType(totalCoins);

        const allTokenTypes: string[] = Object.keys(byTypeAvailable)
          .concat(Object.keys(byTypePending))
          .filter((value, index, self) => self.indexOf(value) === index);

        allTokenTypes.forEach((tokenType: string) => {
          const available = byTypeAvailable[tokenType] || [];
          const pending = byTypePending[tokenType] || [];
          const total = byTypeTotal[tokenType] || [];

          const availableSum = available.reduce((a, b) => a + b, 0n);
          const pendingSum = pending.reduce((a, b) => a + b, 0n);
          const totalSum = availableSum + pendingSum;

          expect(availableBalances[tokenType] ?? 0n).toEqual(availableSum);
          expect(pendingBalances[tokenType] ?? 0n).toEqual(pendingSum);
          expect(totalBalances[tokenType] ?? 0n).toEqual(totalSum);

          const expectedAvailable = fixtureAvailableCoins
            .filter((c) => (c.tokenType as { raw: string }).raw === tokenType)
            .map((c) => c.value);
          const expectedPending = fixturePendingCoins
            .filter((c) => (c.tokenType as { raw: string }).raw === tokenType)
            .map((c) => c.value);
          const expectedTotal = expectedAvailable.concat(expectedPending);

          const bigintCompare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
          const sortedAvailable = pipe(available, Array.sort(bigintCompare));
          const sortedExpectedAvailable = pipe(expectedAvailable, Array.sort(bigintCompare));
          const sortedPending = pipe(pending, Array.sort(bigintCompare));
          const sortedExpectedPending = pipe(expectedPending, Array.sort(bigintCompare));
          const sortedTotal = pipe(total, Array.sort(bigintCompare));
          const sortedExpectedTotal = pipe(expectedTotal, Array.sort(bigintCompare));

          expect(sortedAvailable).toEqual(sortedExpectedAvailable);
          expect(sortedPending).toEqual(sortedExpectedPending);
          expect(sortedTotal).toEqual(sortedExpectedTotal);
        });
      }),
      { numRuns: 10 },
    );
  });

  it('should return correct balances and coins when wallet has a pending spend', () => {
    fc.assert(
      fc.property(fc.array(coinArbitrary), fc.integer({ min: 0, max: 3 }), (availableInputs, numSpends) => {
        const secretKeys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(1));
        const setupAvailableCoins: AvailableCoin[] = availableInputs.map((c) =>
          toAvailableCoin(c as ShieldedTokenType, secretKeys),
        );

        const spendsRaw = setupAvailableCoins.slice(0, Math.min(numSpends, setupAvailableCoins.length - 1));

        const seen = new Set();
        const spends = spendsRaw.filter((c) => {
          if (seen.has(c.coin.nonce)) return false;
          seen.add(c.coin.nonce);
          return true;
        });
        const networkId = NetworkId.NetworkId.Undeployed;
        const capability = makeDefaultCoinsAndBalancesCapability();

        const initialState = createInitialState(secretKeys, setupAvailableCoins);

        // Get initial balances before spending
        const stateBeforeSpends = CoreWallet.init(initialState, secretKeys, networkId);
        const initialAvailableBalances = capability.getAvailableBalances(stateBeforeSpends);

        const localState = issueSpendingOfCoins(initialState, secretKeys, spends);
        const state = CoreWallet.init(localState, secretKeys, networkId);
        const pendingBalances = capability.getPendingBalances(state);
        const availableBalances = capability.getAvailableBalances(state);
        const totalBalances = capability.getTotalBalances(state);
        const pendingCoins = capability.getPendingCoins(state);
        const availableCoinsResult = capability.getAvailableCoins(state);
        const totalCoins = capability.getTotalCoins(state);

        const byTypeRemaining = groupByTokenType(availableCoinsResult);
        Object.entries(byTypeRemaining).forEach(([tokenType, values]) => {
          const sum = values.reduce((a, b) => a + b, 0n);
          expect(availableBalances[tokenType]).toEqual(sum);
          expect(totalBalances[tokenType]).toEqual(sum);
          expect(byTypeRemaining[tokenType]).toEqual(values);
          expect(groupByTokenType(totalCoins)[tokenType]).toEqual(values);
        });
        expect(pendingBalances).toEqual({});
        expect(groupByTokenType(pendingCoins)).toEqual({});

        // Verify that available balances decreased by the correct amount from spends
        const byTypeSpent = groupByTokenType(spends);
        Object.entries(byTypeSpent).forEach(([tokenType, values]) => {
          const spentSum = values.reduce((a, b) => a + b, 0n);
          const initialBalance = initialAvailableBalances[tokenType] ?? 0n;
          const finalBalance = availableBalances[tokenType] ?? 0n;
          expect(finalBalance).toEqual(initialBalance - spentSum);
        });

        expect(state.state.pendingSpends.size).toBe(spends.length);
      }),
      { numRuns: 10 },
    );
  });
});
