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
 * Whether paying a fee with Dust settles when the Dust selected first stops covering the fee once it is spent.
 *
 * @remarks
 *   Balancing is a fixed point: select coins for the fee, dry-run the fee the selection itself adds, and select again
 *   until what was selected covers what it costs. The case that exposes the loop is a coin worth more than the
 *   transaction's own fee but less than that fee plus the cost of spending the coin: the first round selects it, the
 *   second must see it is not enough. With a single such coin the only right answer is `InsufficientFundsError`.
 *
 *   The wallet state is real — Night rewarded, registered and generating Dust in the in-memory simulator — because the
 *   dry run spends the selected coins against the wallet's own Dust state. The capability is built by hand around the
 *   real coins and keys capabilities so that its coin selection can be guarded: a balancing loop that never settles is
 *   synchronous and blocks the event loop, so no test timeout could stop it. The guard turns that into a failure after
 *   a bounded number of coin-selection fetches and calls; a loop that settles never gets near it.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { chooseCoin, type CoinSelection, makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { TransactingCapabilityImplementation } from '../Transacting.js';
import { COST_PARAMETERS, NETWORK, NIGHT, walletWithOneGeneratingDustCoin } from './generatingDustWallet.js';

// Far more coin-selection fetches and calls than a settling balance needs; only a loop that never settles reaches it.
const MAX_COIN_SELECTION_TICKS = 100;

/**
 * The default coin selection, guarded by how often the capability fetches it and how often it calls it.
 *
 * @remarks
 *   A balancing loop can repeat either one without the other: a loop that re-fetches the selection every round but no
 *   longer needs a coin calls it only once, and a loop that keeps one fetched selection calls it on every pass.
 *   Counting both catches either kind, so the guard fails once the total passes the bound. A balance that settles uses
 *   a handful of ticks: one fetch and a couple of calls.
 */
const guardedCoinSelection = (): (() => CoinSelection) => {
  const ticks = { count: 0 };
  const tick = (): void => {
    ticks.count += 1;
    if (ticks.count > MAX_COIN_SELECTION_TICKS) {
      throw new Error(
        `Dust balancing did not settle within ${MAX_COIN_SELECTION_TICKS} coin-selection fetches and calls`,
      );
    }
  };
  const guarded: CoinSelection = (coins) => {
    tick();
    return chooseCoin(coins);
  };
  return () => {
    tick();
    return guarded;
  };
};

describe('paying a fee with Dust', () => {
  it('refuses, rather than spinning, when the coin that covers the fee cannot also cover its own spend', () =>
    Effect.gen(function* () {
      const { dustSecretKey, state, ledgerParameters, now, recipient } = yield* walletWithOneGeneratingDustCoin;

      const keysCapability = makeDefaultKeysCapability();
      const coinsCapability = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
      const transacting = new TransactingCapabilityImplementation<ledger.ProofErasedTransaction>(
        NETWORK,
        COST_PARAMETERS,
        guardedCoinSelection(),
        () => coinsCapability,
        () => keysCapability,
      );

      const ttl = DateOps.addSeconds(now, 3600);
      const intent = ledger.Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
        [],
        [{ type: NIGHT, owner: recipient, value: 1n }],
        [],
      );
      const transaction = ledger.Transaction.fromParts(NETWORK, undefined, undefined, intent);

      const coinAt = (at: Date) => coinsCapability.getAvailableCoinsWithGeneratedDust(state, at);
      const transactionFee = transacting.calculateFee(transaction, ledgerParameters);
      const feeWithOneSpend = (at: Date) =>
        transacting.dryRunFee(coinAt(at), [transaction], dustSecretKey, state, ttl, at, ledgerParameters);

      // The first whole second at which the coin is worth the midpoint between the transaction's fee and that fee plus
      // spending the coin — inside the window, with room either side for the fee's size jitter.
      const target = (transactionFee + feeWithOneSpend(now)) / 2n;
      const balancedAt = Array.from({ length: 3600 }, (_, second) => DateOps.addSeconds(now, second)).find(
        (at) => (coinAt(at)[0]?.value ?? 0n) >= target,
      )!;

      // Preconditions: one coin, inside the window. Below it the first round already fails correctly and this test
      // would pass without exercising anything; above it the first round settles.
      const coins = coinAt(balancedAt);
      expect(coins).toHaveLength(1);
      expect(coins[0].value).toBeGreaterThan(transactionFee);
      expect(coins[0].value).toBeLessThan(feeWithOneSpend(balancedAt));

      const balanced = transacting.balanceTransactions(
        dustSecretKey,
        state,
        [transaction],
        ttl,
        balancedAt,
        ledgerParameters,
      );

      const outcome = Either.match(balanced, {
        onLeft: (error) => ({ tag: error._tag, message: error.message }),
        onRight: () => ({ tag: 'balanced', message: '' }),
      });
      expect(outcome.tag, outcome.message).toBe('Wallet.InsufficientFunds');
    }).pipe(Effect.scoped, Effect.runPromise));
});
