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
import { Either } from 'effect';
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import * as ledger from '@midnightntwrk/ledger-v9';
import { type CombinedTokenTransfer, type FacadeState, type UtxoWithMeta } from '@midnightntwrk/wallet-sdk-facade';
import { isInsufficientDustForFeeError } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { createWalletLifecycle } from '@midnightntwrk/wallet-sdk-testkit';
import { useTestContainersFixture } from './test-fixture.js';
import { carried } from './helpers/transactions.js';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { failingAfter, within } from './helpers/stateWaiters.js';
import { tNightAmount } from './helpers/primitives.js';
import {
  isGenerator,
  isRegistered,
  parseFundingEnvironment,
  planNightTopUp,
  planRegistration,
  planStableTopUp,
  readinessProblems,
  registerWithRetries,
} from './helpers/fundingPlan.js';

// Provisions the wallets the remote suites run against. Run it on its own with `yarn turbo test-fund` from the
// repository root; no other run selects it, so a nightly or a bare `yarn test-e2e` never spends the funding wallet.
//
//   SEED                 the wallet the funds come from (a faucet wallet) — required
//   SEED2                the test wallet to fund — required unless FUND_RANDOM_TARGET=true. Point it at whichever wallet
//                        a suite runs on: the dust healthchecks' wallet (the suites' own SEED), NT_SEED, NT_SEED2, ...
//   FUND_RANDOM_TARGET   `true` funds a freshly generated wallet instead of SEED2 and prints its seed to the console;
//                        `false` or unset funds SEED2, and any other value is refused
//   SEED_STABLE          the balance-constant wallet; its test is skipped when unset
//
// The three seeds must differ: a wallet funding itself waits for a balance that never rises.
//
// These names mean something different here than in the suites, where SEED is a test wallet. `setup-env.ts` loads the
// repository's `.env` with `override: true`, so values set on the command line are replaced by the `.env` ones: set
// them in `.env`, or run from a checkout that has none.

const environment = parseFundingEnvironment(process.env);

const unshieldedTokenRaw = ledger.unshieldedToken().raw;

/** A shielded balance a test wallet holds at least. Shielded only: the top-up below sends shielded transfers. */
type ShieldedMinimum = { readonly label: string; readonly tokenType: string; readonly amount: bigint };

/**
 * Shielded balances every test wallet holds at least: tNight, which the token-transfer suites send and need change
 * from, and the two native tokens the native-token transfer suite moves between its wallets.
 */
const TEST_WALLET_SHIELDED_MINIMUMS: readonly ShieldedMinimum[] = [
  { label: 'shielded tNight', tokenType: ledger.shieldedToken().raw, amount: tNightAmount(1000n) },
  { label: 'native token 1', tokenType: utils.nativeToken1Raw, amount: tNightAmount(25n) },
  { label: 'native token 2', tokenType: utils.nativeToken2Raw, amount: tNightAmount(50n) },
];

const syncTimeout = 90 * 60 * 1000;
/** A single wait inside a test; shorter than the test's own timeout so a stalled stage reports which one it was. */
const stageTimeout = 30 * 60 * 1000;
const stopTimeout = 600_000;
/** How long a funding transaction may wait to be included before it expires. */
const fundingTtlMs = 30 * 60 * 1000;

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
 * pending coins just as a successful one does, so the outcome is read from the transaction history instead:
 * `waitForTxInHistory` fails on any end other than a successful finalization.
 */
const expectSucceeded = async (
  wallet: utils.WalletInit,
  finalized: Parameters<typeof wallet.wallet.submitTransaction>[0],
  what: string,
): Promise<void> => {
  const txHash = carried<ledger.FinalizedTransaction>(finalized).transactionHash();
  await within(`${what} ${txHash} to finalize`, stageTimeout, utils.waitForTxInHistory(txHash, wallet.wallet));
};

/** Waits for a wallet to report itself synced, naming the wallet when it does not in time. */
const synced = (wallet: utils.WalletInit, which: string, milliseconds: number = stageTimeout) =>
  within(`the ${which} wallet to sync`, milliseconds, wallet.wallet.waitForSyncedState());

/** Waits for a wallet's pending coins to clear, naming the wallet when they do not in time. */
const pendingCleared = (wallet: utils.WalletInit, which: string) =>
  within(`the ${which} wallet's pending coins to clear`, stageTimeout, utils.waitForFacadePendingClear(wallet.wallet));

const submitTransfer = async (sender: utils.WalletInit, transfers: CombinedTokenTransfer[]): Promise<void> => {
  const recipe = await sender.wallet.transferTransaction(transfers, { ttl: new Date(Date.now() + fundingTtlMs) });
  const signed = await sender.wallet.signRecipe(recipe, sender.unshieldedKeystore.signDataAsync);
  const finalized = await sender.wallet.finalizeRecipe(signed);
  const txId = await sender.wallet.submitTransaction(finalized);
  logger.info(`Funding transaction submitted: ${txId}`);
  await expectSucceeded(sender, finalized, 'Funding transaction');
  await pendingCleared(sender, 'funding');
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
      failingAfter(what, timeoutMs),
    ),
  );

/** How many times a registration is rebuilt after waiting out a fee shortfall before the script gives up. */
const MAX_REGISTRATION_ATTEMPTS = 3;

/**
 * Registers Night UTxOs for Dust generation in one transaction. A wallet with no Dust yet pays the registration fee out
 * of the Dust a single one of those UTxOs has generated, the one that has generated most, which is why the generator is
 * ten times the base amount. When that falls short, the registration is built again once generation is estimated to
 * cover the fee. Each build can carry a different fee, so a later one can fall short too; it is built at most
 * {@link MAX_REGISTRATION_ATTEMPTS} times in all.
 */
const registerForDust = async (wallet: utils.WalletInit, utxos: readonly UtxoWithMeta[]): Promise<void> => {
  const register = () =>
    wallet.wallet.registerNightUtxosForDustGeneration(
      utxos,
      wallet.unshieldedKeystore.getPublicKey(),
      wallet.unshieldedKeystore.signDataAsync,
    );

  const waitOutShortfall = async (error: unknown, attempt: number): Promise<void> => {
    if (!isInsufficientDustForFeeError(error)) throw error;
    if (error.estimate._tag !== 'Reachable') {
      throw new Error(
        `Night UTxOs worth ${utxos.map((u) => u.utxo.value).join(' + ')} can never pay their own registration fee ` +
          `of ${error.fee} (${error.estimate.reason}); fund a larger generator`,
        { cause: error },
      );
    }
    const waitMs = Number(error.estimate.seconds) * 1000 + 60_000;
    if (waitMs > stageTimeout) {
      throw new Error(
        `The Night to register needs about ${error.estimate.seconds}s to generate its ${error.fee} Specks fee, longer ` +
          `than the ${stageTimeout / 1000}s a stage may wait; fund a larger generator`,
        { cause: error },
      );
    }
    logger.info(
      `The unregistered UTxO that has generated most Dust holds ${error.claimableFeePayment} of the ${error.fee} ` +
        `Specks this registration costs; waiting about ${error.estimate.seconds}s for the rest (attempt ${attempt})`,
    );
    await wallet.wallet.waitForGeneratedDust(utxos, error.fee, { timeoutMs: waitMs });
  };

  const recipe = await registerWithRetries(register, waitOutShortfall, MAX_REGISTRATION_ATTEMPTS);

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  const txId = await wallet.wallet.submitTransaction(finalized);
  logger.info(`Dust registration submitted: ${txId}`);
  await expectSucceeded(wallet, finalized, 'Dust registration');
};

describe('Fund remote test wallets', () => {
  if (Either.isLeft(environment)) {
    throw new Error(environment.left);
  }
  const { funder: fundedSeed, target: fundingTarget, stable: stableSeed } = environment.right;
  const useRandomTarget = fundingTarget._tag === 'Random';
  const targetSeed = fundingTarget._tag === 'Random' ? randomBytes(32).toString('hex') : fundingTarget.seed;

  const getFixture = useTestContainersFixture();
  // Every wallet started here is adopted as soon as it exists, so one that finishes starting after a timed-out
  // `beforeAll` is still stopped, and teardown reports every stop that fails rather than only the first.
  const lifecycle = createWalletLifecycle();
  let sender: utils.WalletInit;
  let target: utils.WalletInit;

  beforeAll(async () => {
    const fixture = getFixture();
    if (useRandomTarget) {
      // The console only, never the logger: the logger writes to files that end up in test reports, and anyone with
      // this seed can spend the wallet.
      process.stdout.write(`Funding a newly generated wallet; save its seed to reuse it: ${targetSeed}\n`);
    }
    sender = await lifecycle.adopt(utils.initWalletWithSeed(fundedSeed, fixture));
    target = await lifecycle.adopt(utils.initWalletWithSeed(targetSeed, fixture));
    await Promise.all([synced(sender, 'funding', syncTimeout), synced(target, 'target', syncTimeout)]);
  }, syncTimeout);

  afterAll(async () => {
    await lifecycle.release({ persist: false });
  }, stopTimeout);

  test(
    'should top a test wallet up to five Night UTxOs, a registered generator with Dust to pay fees, and its shielded minimums, so both dust healthchecks and the transfer suites can run on it',
    async () => {
      const before = await synced(target, 'target');
      const nightBefore = nightUtxosOf(before);
      const hasGenerator = nightBefore.some(isGenerator);
      const unregisteredOthers = nightBefore.filter((coin) => !isGenerator(coin) && !isRegistered(coin));
      const nightAmounts = planNightTopUp(nightBefore);
      const shieldedShortfalls = TEST_WALLET_SHIELDED_MINIMUMS.map((minimum) => ({
        ...minimum,
        short: minimum.amount - balanceOf(before.shielded.balances, minimum.tokenType),
      })).filter(({ short }) => short > 0n);
      logger.info(
        `Target ${utils.getUnshieldedAddress(getFixture().getNetworkId(), before.unshielded.address)} balances — shielded: ${inspect(before.shielded.balances)}, ` +
          `unshielded: ${inspect(before.unshielded.balances)}`,
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
        assertFunderCovers(await synced(sender, 'funding'), transfers);
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

      const funded = await synced(target, 'target');
      expect(nightUtxosOf(funded).some(isGenerator), 'No generator UTxO on the target wallet').toBe(true);
      const step = planRegistration(nightUtxosOf(funded), dustOf(funded));
      if (step._tag === 'Ready') {
        logger.info(`Target's generator and registered Night are in place, with ${dustOf(funded)} Specks of Dust`);
      } else {
        if (step._tag === 'WaitForDust') {
          logger.info('Target has its registered Night but no Dust yet; waiting for it to generate');
        } else {
          await registerForDust(target, step.utxos);
          // Registration spends the registered UTxOs and recreates them, so they are pending until it settles.
          await pendingCleared(target, 'target');
        }
        await waitForState(
          target,
          (state) => planRegistration(nightUtxosOf(state), dustOf(state))._tag === 'Ready',
          'the target wallet to have its generator and registered Night, and Dust',
        );
      }

      const final = await synced(target, 'target');
      const nightFinal = nightUtxosOf(final);
      logger.info(nightFinal.map((coin) => `${coin.utxo.value} registered=${isRegistered(coin)}`).join(', '));
      logger.info(`Target Dust: ${dustOf(final)} Specks`);
      const problems = readinessProblems(nightFinal, dustOf(final));
      expect(problems, `Target wallet cannot serve the dust healthchecks: ${problems.join('; ')}`).toEqual([]);
      expect(holdsShieldedMinimums(final), `Shielded balances below minimum: ${inspect(final.shielded.balances)}`).toBe(
        true,
      );
    },
    syncTimeout,
  );

  test.skipIf(stableSeed === undefined)(
    'should top the stable wallet up to the balances the balance-constant suite asserts, and fail naming any it already exceeds',
    async () => {
      if (stableSeed === undefined) return;
      const stable = await lifecycle.adopt(utils.initWalletWithSeed(stableSeed, getFixture()));
      const before = await synced(stable, 'stable');
      const heldBy = (state: FacadeState) =>
        utils.STABLE_WALLET_BALANCES.map((target) => ({
          ...target,
          held: balanceOf(state[target.kind].balances, target.tokenType),
        }));
      const describeHeld = (state: FacadeState) =>
        heldBy(state)
          .map(({ label, held, amount }) => `${label} ${held} of ${amount}`)
          .join('; ');

      const { short, over } = planStableTopUp(heldBy(before));
      if (short.length === 0) {
        logger.info('Stable wallet holds no balance below its target; nothing sent');
      } else {
        const shortOf = (kind: 'shielded' | 'unshielded') => short.filter((balance) => balance.kind === kind);
        const shieldedOutputs = shortOf('shielded').map(({ tokenType, short: amount }) => ({
          type: tokenType,
          amount,
          receiverAddress: before.shielded.address,
        }));
        const unshieldedOutputs = shortOf('unshielded').map(({ tokenType, short: amount }) => ({
          type: tokenType,
          amount,
          receiverAddress: before.unshielded.address,
        }));
        const transfers: CombinedTokenTransfer[] = [
          ...(shieldedOutputs.length > 0 ? [{ type: 'shielded' as const, outputs: shieldedOutputs }] : []),
          ...(unshieldedOutputs.length > 0 ? [{ type: 'unshielded' as const, outputs: unshieldedOutputs }] : []),
        ];
        logger.info(
          `Topping up the stable wallet ${utils.getUnshieldedAddress(getFixture().getNetworkId(), before.unshielded.address)}: ${short.map(({ label }) => label).join(', ')}`,
        );

        assertFunderCovers(await synced(sender, 'funding'), transfers);
        await submitTransfer(sender, transfers);
        // Each balance that was short must land exactly on its target. One that goes past it, from a stray output or
        // another sender, will never come back down, so it fails at once rather than after the whole stage.
        await rx.firstValueFrom(
          stable.wallet.state().pipe(
            rx.filter((state) => state.isSynced),
            rx.tap((state) => {
              const overshot = heldBy(state).filter(
                ({ held, amount, label }) => held > amount && short.some((balance) => balance.label === label),
              );
              if (overshot.length > 0) {
                throw new Error(`The stable wallet went past its target: ${describeHeld(state)}`);
              }
            }),
            rx.filter((state) =>
              heldBy(state).every(
                ({ held, amount, label }) => held === amount || !short.some((balance) => balance.label === label),
              ),
            ),
            rx.timeout({
              first: stageTimeout,
              with: () =>
                stable.wallet.state().pipe(
                  rx.take(1),
                  rx.mergeMap((state) =>
                    rx.throwError(
                      () =>
                        new Error(
                          `Timed out after ${stageTimeout}ms waiting for the stable wallet to reach its target ` +
                            `balances; last seen: ${describeHeld(state)}`,
                        ),
                    ),
                  ),
                ),
            }),
          ),
        );
      }

      // Funding cannot take a balance back down, so one above its target has to be drained by hand before the
      // balance-constant suite can pass.
      expect(
        over.map(({ label, held, amount }) => `${label} ${held} > ${amount}`),
        'Stable wallet balances above their target; drain them by hand',
      ).toEqual([]);
      // One coin per shielded token the stable wallet holds: tNight and the two native tokens.
      const after = await synced(stable, 'stable');
      expect(after.shielded.availableCoins.length).toBeGreaterThanOrEqual(
        utils.STABLE_WALLET_BALANCES.filter(({ kind }) => kind === 'shielded').length,
      );
    },
    syncTimeout,
  );
});
