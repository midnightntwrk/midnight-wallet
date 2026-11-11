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
import * as rx from 'rxjs';
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  type CombinedTokenTransfer,
  type FacadeState,
  isFinalizedWalletEntry,
  type UtxoWithMeta,
} from '@midnightntwrk/wallet-sdk-facade';
import { isInsufficientDustForFeeError } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { useTestContainersFixture } from './test-fixture.js';
import { carried } from './helpers/transactions.js';
import * as utils from './utils.js';
import { logger } from './logger.js';
import {
  isGenerator,
  isRegistered,
  MIN_UNREGISTERED_OTHERS,
  planNightTopUp,
  planRegistration,
  readinessProblems,
} from './helpers/fundingPlan.js';

// Provisions the wallets the remote suites run against. Run it on its own with `yarn test-fund`; no other run selects
// it, so a nightly or a bare `yarn test-e2e` never spends the funding wallet.
//
//   SEED                 the wallet the funds come from (a faucet wallet) — required
//   SEED2                the test wallet to fund — required unless FUND_RANDOM_TARGET=true. Point it at whichever wallet
//                        a suite runs on: the dust healthchecks' wallet (the suites' own SEED), NT_SEED, NT_SEED2, ...
//   FUND_RANDOM_TARGET   `true` funds a freshly generated wallet instead of SEED2 and logs its seed
//   SEED_STABLE          the balance-constant wallet; its test is skipped when unset
//
// These names mean something different here than in the suites, where SEED is a test wallet. `setup-env.ts` loads the
// repository's `.env` with `override: true`, so values set on the command line are replaced by the `.env` ones: set
// them in `.env`, or run from a checkout that has none.

/** An empty value, as `NAME=` in `.env` leaves, counts as unset. */
const envOf = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

const fundedSeed = envOf('SEED');
const useRandomTarget = envOf('FUND_RANDOM_TARGET') === 'true';
const targetSeed = useRandomTarget ? randomBytes(32).toString('hex') : envOf('SEED2');
const stableSeed = envOf('SEED_STABLE');

const unshieldedTokenRaw = ledger.unshieldedToken().raw;

/**
 * Shielded balances every test wallet holds at least: tNight, and the two native tokens the native-token transfer suite
 * moves between its wallets. They are the stable wallet's amounts, which the stable wallet holds exactly.
 */
const TEST_WALLET_SHIELDED_MINIMUMS = [
  utils.STABLE_WALLET.shielded,
  utils.STABLE_WALLET.nativeToken1,
  utils.STABLE_WALLET.nativeToken2,
] as const;

const syncTimeout = 90 * 60 * 1000;
/** A single wait inside a test; shorter than the test's own timeout so a stalled stage reports which one it was. */
const stageTimeout = 30 * 60 * 1000;
const stopTimeout = 600_000;

const balanceOf = (balances: Record<string, bigint>, tokenType: string): bigint => balances[tokenType] ?? 0n;

const nightUtxosOf = (state: FacadeState): readonly UtxoWithMeta[] =>
  state.unshielded.availableCoins.filter((coin) => coin.utxo.type === unshieldedTokenRaw);

const dustOf = (state: FacadeState): bigint => state.dust.balance(new Date());

const holdsShieldedMinimums = (state: FacadeState): boolean =>
  TEST_WALLET_SHIELDED_MINIMUMS.every(
    ({ tokenType, amount }) => balanceOf(state.shielded.balances, tokenType) >= amount,
  );

/** What a set of transfers takes out of the sender, per balance kind and token. */
const requiredFrom = (transfers: readonly CombinedTokenTransfer[]) =>
  transfers.flatMap((transfer) =>
    transfer.outputs.map((output) => ({ kind: transfer.type, tokenType: output.type, amount: output.amount })),
  );

/** Fails before anything is built when the funding wallet cannot cover every output it is about to send. */
const assertFunderCovers = (state: FacadeState, transfers: readonly CombinedTokenTransfer[]): void => {
  const groups = Object.groupBy(requiredFrom(transfers), ({ kind, tokenType }) => `${kind}:${tokenType}`);
  const totals = Object.values(groups).flatMap((group = []) =>
    group.slice(0, 1).map(({ kind, tokenType }) => ({
      kind,
      tokenType,
      needed: group.reduce((total, r) => total + r.amount, 0n),
    })),
  );
  const shortfalls = totals
    .map((total) => ({ ...total, held: balanceOf(state[total.kind].balances, total.tokenType) }))
    .filter(({ needed, held }) => held < needed);

  expect(
    shortfalls,
    `Funding wallet (SEED) cannot cover the transfer: ${shortfalls
      .map(({ kind, tokenType, needed, held }) => `${kind} ${tokenType} needs ${needed}, holds ${held}`)
      .join('; ')}`,
  ).toEqual([]);
};

/**
 * Waits for a submitted transaction to finalize successfully. A rejected or expired transaction clears the wallet's
 * pending coins just as a successful one does, so the outcome is read from the transaction history instead.
 */
const expectSucceeded = async (
  wallet: utils.WalletInit,
  finalized: Parameters<typeof wallet.wallet.submitTransaction>[0],
  what: string,
): Promise<void> => {
  const txHash = carried<ledger.FinalizedTransaction>(finalized).transactionHash();
  const entry = await utils.waitForTxInHistory(txHash, wallet.wallet);
  expect(isFinalizedWalletEntry(entry) && entry.status, `${what} ${txHash} did not succeed`).toBe('SUCCESS');
};

const submitTransfer = async (sender: utils.WalletInit, transfers: CombinedTokenTransfer[]): Promise<string> => {
  const recipe = await sender.wallet.transferTransaction(transfers, { ttl: new Date(Date.now() + 30 * 60 * 1000) });
  const signed = await sender.wallet.signRecipe(recipe, sender.unshieldedKeystore.signDataAsync);
  const finalized = await sender.wallet.finalizeRecipe(signed);
  const txId = await sender.wallet.submitTransaction(finalized);
  logger.info(`Funding transaction submitted: ${txId}`);
  await expectSucceeded(sender, finalized, 'Funding transaction');
  await utils.waitForFacadePendingClear(sender.wallet);
  return txId;
};

const waitForState = (
  wallet: utils.WalletInit,
  predicate: (state: FacadeState) => boolean,
  what: string,
  timeoutMs: number = stageTimeout,
) =>
  rx.firstValueFrom(
    wallet.wallet.state().pipe(
      rx.filter((state) => state.isSynced && predicate(state)),
      rx.timeout({
        first: timeoutMs,
        with: () => rx.throwError(() => new Error(`Timed out waiting for ${what}`)),
      }),
    ),
  );

/** How many times a registration is rebuilt after waiting out a fee shortfall before the script gives up. */
const MAX_REGISTRATION_ATTEMPTS = 3;

/**
 * Registers Night UTxOs for Dust generation in one transaction. A wallet with no Dust yet pays the registration fee out
 * of the Dust the UTxOs themselves have generated, so when that falls short the call is retried once generation is
 * estimated to cover it. Each retry builds a new transaction whose fee can differ from the last, so a retry can fall
 * short again; it is retried up to {@link MAX_REGISTRATION_ATTEMPTS} times.
 */
const registerForDust = async (wallet: utils.WalletInit, utxos: readonly UtxoWithMeta[]): Promise<void> => {
  const register = (attempt: number): ReturnType<typeof wallet.wallet.registerNightUtxosForDustGeneration> =>
    wallet.wallet
      .registerNightUtxosForDustGeneration(
        utxos,
        wallet.unshieldedKeystore.getPublicKey(),
        wallet.unshieldedKeystore.signDataAsync,
      )
      .catch((error: unknown) => waitOutShortfall(error, attempt));

  const waitOutShortfall = async (error: unknown, attempt: number) => {
    if (!isInsufficientDustForFeeError(error) || attempt >= MAX_REGISTRATION_ATTEMPTS) throw error;
    if (error.estimate._tag !== 'Reachable') {
      throw new Error(
        `Night UTxOs worth ${utxos.map((u) => u.utxo.value).join(' + ')} can never pay their own registration fee ` +
          `of ${error.fee} (${error.estimate.reason}); fund a larger generator`,
      );
    }
    logger.info(
      `Registered Night has ${error.claimableFeePayment} of the ${error.fee} Specks its registration costs; ` +
        `waiting about ${error.estimate.seconds}s for it to generate the rest (attempt ${attempt})`,
    );
    await wallet.wallet.waitForGeneratedDust(utxos, error.fee, {
      timeoutMs: Number(error.estimate.seconds) * 1000 + 60_000,
    });
    return register(attempt + 1);
  };

  const recipe = await register(1);

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  const txId = await wallet.wallet.submitTransaction(finalized);
  logger.info(`Dust registration submitted: ${txId}`);
  await expectSucceeded(wallet, finalized, 'Dust registration');
};

describe('Fund remote test wallets', () => {
  if (fundedSeed === undefined) {
    throw new Error('SEED must be set to a wallet that holds funds');
  }
  if (targetSeed === undefined) {
    throw new Error('SEED2 must be set to the wallet to fund, or set FUND_RANDOM_TARGET=true to fund a new one');
  }

  const getFixture = useTestContainersFixture();
  let sender: utils.WalletInit;
  let target: utils.WalletInit;

  beforeAll(async () => {
    const fixture = getFixture();
    if (useRandomTarget) {
      logger.info(`Funding a newly generated wallet; save its seed to reuse it: ${targetSeed}`);
    }
    sender = await utils.initWalletWithSeed(fundedSeed, fixture);
    target = await utils.initWalletWithSeed(targetSeed, fixture);
    await Promise.all([sender.wallet.waitForSyncedState(), target.wallet.waitForSyncedState()]);
  }, syncTimeout);

  afterAll(async () => {
    await Promise.all([sender?.wallet.stop(), target?.wallet.stop()]);
  }, stopTimeout);

  test(
    'tops a test wallet up to five Night UTxOs, registered Night with Dust to pay fees, and its shielded minimums',
    async () => {
      const before = await target.wallet.waitForSyncedState();
      const nightBefore = nightUtxosOf(before);
      const hasGenerator = nightBefore.some(isGenerator);
      const unregisteredOthers = nightBefore.filter((coin) => !isGenerator(coin) && !isRegistered(coin));
      const registeredBefore = nightBefore.filter(isRegistered).length;
      const nightAmounts = planNightTopUp(nightBefore);
      const shieldedShortfalls = TEST_WALLET_SHIELDED_MINIMUMS.map((minimum) => ({
        ...minimum,
        short: minimum.amount - balanceOf(before.shielded.balances, minimum.tokenType),
      })).filter(({ short }) => short > 0n);
      logger.info(
        `Target balances — shielded: ${inspect(before.shielded.balances)}, unshielded: ${inspect(before.unshielded.balances)}`,
      );
      logger.info(
        `Target holds ${nightBefore.length} Night UTxOs (generator: ${hasGenerator}, unregistered others: ` +
          `${unregisteredOthers.length}); sending ${nightAmounts.length} Night UTxOs and shielded ` +
          `[${shieldedShortfalls.map(({ label }) => label).join(', ')}]`,
      );

      const transfers: CombinedTokenTransfer[] = [
        ...(nightAmounts.length > 0
          ? [
              {
                type: 'unshielded' as const,
                outputs: nightAmounts.map((amount) => ({
                  type: unshieldedTokenRaw,
                  amount,
                  receiverAddress: before.unshielded.address,
                })),
              },
            ]
          : []),
        ...(shieldedShortfalls.length > 0
          ? [
              {
                type: 'shielded' as const,
                outputs: shieldedShortfalls.map(({ tokenType, short }) => ({
                  type: tokenType,
                  amount: short,
                  receiverAddress: before.shielded.address,
                })),
              },
            ]
          : []),
      ];

      if (transfers.length > 0) {
        assertFunderCovers(await sender.wallet.waitForSyncedState(), transfers);
        await submitTransfer(sender, transfers);
        await waitForState(
          target,
          (state) =>
            nightUtxosOf(state).length >= nightBefore.length + nightAmounts.length && holdsShieldedMinimums(state),
          'the funded UTxOs to reach the target wallet',
        );
      } else {
        logger.info('Target already holds the UTxOs and shielded balances it needs; nothing sent');
      }

      const funded = await target.wallet.waitForSyncedState();
      if (registeredBefore > 0) {
        expect(
          nightUtxosOf(funded).filter(isRegistered).length,
          'Night sent to a wallet with registered Night must arrive registered',
        ).toBe(registeredBefore + nightAmounts.length);
      }
      expect(nightUtxosOf(funded).some(isGenerator), 'No generator UTxO on the target wallet').toBe(true);
      const step = planRegistration(nightUtxosOf(funded), dustOf(funded));
      if (step._tag === 'Ready') {
        logger.info(`Target has registered Night and ${dustOf(funded)} Specks of Dust; not registering`);
      } else {
        if (step._tag === 'WaitForDust') {
          logger.info('Target has registered Night but no Dust yet; waiting for it to generate');
        } else {
          await registerForDust(target, step.utxos);
          // Registration spends the registered UTxOs and recreates them, so they are pending until it settles.
          await utils.waitForFacadePendingClear(target.wallet);
        }
        await waitForState(
          target,
          (state) => dustOf(state) > 0n && nightUtxosOf(state).some(isRegistered),
          'the target wallet to have registered Night and Dust',
        );
      }

      const final = await target.wallet.waitForSyncedState();
      const nightFinal = nightUtxosOf(final);
      logger.info(nightFinal.map((coin) => `${coin.utxo.value} registered=${isRegistered(coin)}`).join(', '));
      logger.info(`Target Dust: ${dustOf(final)} Specks`);
      const problems = readinessProblems(nightFinal, dustOf(final));
      expect(problems, `Target wallet cannot serve the dust healthchecks: ${problems.join('; ')}`).toEqual([]);
      const unregisteredOthersFinal = nightFinal.filter((coin) => !isGenerator(coin) && !isRegistered(coin)).length;
      if (registeredBefore === 0) {
        expect(unregisteredOthersFinal).toBeGreaterThanOrEqual(MIN_UNREGISTERED_OTHERS);
      } else if (unregisteredOthersFinal < MIN_UNREGISTERED_OTHERS) {
        logger.warn(
          `Target holds ${unregisteredOthersFinal} unregistered Night UTxOs; the dust registration healthcheck needs ` +
            `${MIN_UNREGISTERED_OTHERS}, and funding a registered wallet cannot add them`,
        );
      }
      expect(holdsShieldedMinimums(final), `Shielded balances below minimum: ${inspect(final.shielded.balances)}`).toBe(
        true,
      );
    },
    syncTimeout,
  );

  test.skipIf(stableSeed === undefined)(
    'tops the stable wallet up to the balances the balance-constant suite asserts',
    async () => {
      const stable = await utils.initWalletWithSeed(stableSeed!, getFixture());
      try {
        const before = await stable.wallet.waitForSyncedState();
        const current = utils.STABLE_WALLET_BALANCES.map((target) => ({
          ...target,
          held: balanceOf(before[target.kind].balances, target.tokenType),
        }));

        const over = current.filter(({ held, amount }) => held > amount);
        if (over.length > 0) {
          logger.warn(
            `Stable wallet already holds more than its target, so nothing is sent: ${over
              .map(({ label, held, amount }) => `${label} ${held} > ${amount}`)
              .join('; ')}`,
          );
          return;
        }

        const missing = current.filter(({ held, amount }) => held < amount);
        if (missing.length === 0) {
          logger.info('Stable wallet already holds its target balances; nothing sent');
          return;
        }

        const shortOf = (kind: 'shielded' | 'unshielded') =>
          missing
            .filter((balance) => balance.kind === kind)
            .map(({ tokenType, amount, held }) => ({ type: tokenType, amount: amount - held }));
        const shieldedOutputs = shortOf('shielded').map((output) => ({
          ...output,
          receiverAddress: before.shielded.address,
        }));
        const unshieldedOutputs = shortOf('unshielded').map((output) => ({
          ...output,
          receiverAddress: before.unshielded.address,
        }));
        const transfers: CombinedTokenTransfer[] = [
          ...(shieldedOutputs.length > 0 ? [{ type: 'shielded' as const, outputs: shieldedOutputs }] : []),
          ...(unshieldedOutputs.length > 0 ? [{ type: 'unshielded' as const, outputs: unshieldedOutputs }] : []),
        ];
        logger.info(`Topping up the stable wallet: ${missing.map(({ label }) => label).join(', ')}`);

        assertFunderCovers(await sender.wallet.waitForSyncedState(), transfers);
        await submitTransfer(sender, transfers);
        const after = await waitForState(
          stable,
          (state) =>
            utils.STABLE_WALLET_BALANCES.every(
              (target) => balanceOf(state[target.kind].balances, target.tokenType) === target.amount,
            ),
          'the stable wallet to reach its target balances',
        );
        expect(after.shielded.availableCoins.length).toBeGreaterThanOrEqual(3);
      } finally {
        await stable.wallet.stop();
      }
    },
    syncTimeout,
  );
});
