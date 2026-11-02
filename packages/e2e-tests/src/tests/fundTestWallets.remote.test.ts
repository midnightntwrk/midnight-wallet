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
import { type CombinedTokenTransfer, type FacadeState, type UtxoWithMeta } from '@midnightntwrk/wallet-sdk-facade';
import { isInsufficientDustForFeeError } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { useTestContainersFixture } from './test-fixture.js';
import * as utils from './utils.js';
import { logger } from './logger.js';

// Provisions the wallets the remote suites run against. Run it on its own with `yarn test-fund`; the `remote`
// project excludes it so a nightly run never spends the funding wallet.
//
//   SEED                 a wallet that already holds funds (a faucet wallet) — required
//   SEED2                the dust-test wallet to fund — required unless FUND_RANDOM_TARGET=true
//   FUND_RANDOM_TARGET   `true` funds a freshly generated wallet instead of SEED2 and logs its seed
//   SEED_STABLE          the balance-constant wallet; its test is skipped when unset

const fundedSeed = process.env['SEED'];
const useRandomTarget = process.env['FUND_RANDOM_TARGET'] === 'true';
const targetSeed = useRandomTarget ? randomBytes(32).toString('hex') : process.env['SEED2'];
const stableSeed = process.env['SEED_STABLE'];

const unshieldedTokenRaw = ledger.unshieldedToken().raw;
const shieldedTokenRaw = ledger.shieldedToken().raw;

/** The amount a test wallet normally receives in one UTxO. */
const BASE_AMOUNT = utils.tNightAmount(10n);
/** One Night UTxO is this much larger and registered, so the wallet generates enough Dust to pay its own fees. */
const DUST_GENERATOR_AMOUNT = BASE_AMOUNT * 10n;
/**
 * The dust healthchecks register two unregistered Night UTxOs and then deregister two registered ones, so the wallet
 * needs the generator plus enough others to keep at least two unregistered between runs.
 */
const MIN_NIGHT_UTXOS = 5;
const MIN_UNREGISTERED_OTHERS = 2;
/**
 * Shielded balances every test wallet holds at least: tNight, and the two native tokens the native-token transfer suite
 * moves between its wallets.
 */
const TEST_WALLET_SHIELDED_MINIMUMS = [
  { label: 'shielded tNight', tokenType: shieldedTokenRaw, amount: BASE_AMOUNT },
  { label: 'native token 1', tokenType: utils.nativeToken1Raw, amount: utils.tNightAmount(25n) },
  { label: 'native token 2', tokenType: utils.nativeToken2Raw, amount: utils.tNightAmount(50n) },
] as const;

const syncTimeout = 90 * 60 * 1000;
const stopTimeout = 600_000;

const balanceOf = (balances: Record<string, bigint>, tokenType: string): bigint => balances[tokenType] ?? 0n;

const nightUtxosOf = (state: FacadeState): readonly UtxoWithMeta[] =>
  state.unshielded.availableCoins.filter((coin) => coin.utxo.type === unshieldedTokenRaw);

const isGenerator = (coin: UtxoWithMeta): boolean => coin.utxo.value >= DUST_GENERATOR_AMOUNT;

const dustOf = (state: FacadeState): bigint => state.dust.balance(new Date());

const holdsShieldedMinimums = (state: FacadeState): boolean =>
  TEST_WALLET_SHIELDED_MINIMUMS.every(
    ({ tokenType, amount }) => balanceOf(state.shielded.balances, tokenType) >= amount,
  );

const sum = (amounts: readonly bigint[]): bigint => amounts.reduce((total, amount) => total + amount, 0n);

/** What a set of transfers takes out of the sender, per balance kind and token. */
const requiredFrom = (transfers: readonly CombinedTokenTransfer[]) =>
  transfers.flatMap((transfer) =>
    transfer.outputs.map((output) => ({ kind: transfer.type, tokenType: output.type, amount: output.amount })),
  );

/** Fails before anything is built when the funding wallet cannot cover every output it is about to send. */
const assertFunderCovers = (state: FacadeState, transfers: readonly CombinedTokenTransfer[]): void => {
  const required = requiredFrom(transfers);
  const keys = [...new Set(required.map(({ kind, tokenType }) => `${kind}:${tokenType}`))];
  const shortfalls = keys
    .map((key) => {
      const [kind, tokenType] = key.split(':') as ['shielded' | 'unshielded', string];
      const needed = sum(required.filter((r) => r.kind === kind && r.tokenType === tokenType).map((r) => r.amount));
      const held = balanceOf(state[kind].balances, tokenType);
      return { kind, tokenType, needed, held };
    })
    .filter(({ needed, held }) => held < needed);

  expect(
    shortfalls,
    `Funding wallet (SEED) cannot cover the transfer: ${shortfalls
      .map(({ kind, tokenType, needed, held }) => `${kind} ${tokenType} needs ${needed}, holds ${held}`)
      .join('; ')}`,
  ).toEqual([]);
};

const submitTransfer = async (sender: utils.WalletInit, transfers: CombinedTokenTransfer[]): Promise<string> => {
  const recipe = await sender.wallet.transferTransaction(transfers, { ttl: new Date(Date.now() + 30 * 60 * 1000) });
  const signed = await sender.wallet.signRecipe(recipe, sender.unshieldedKeystore.signDataAsync);
  const finalized = await sender.wallet.finalizeRecipe(signed);
  const txId = await sender.wallet.submitTransaction(finalized);
  logger.info(`Funding transaction submitted: ${txId}`);
  await utils.waitForFacadePendingClear(sender.wallet);
  return txId;
};

const waitForState = (wallet: utils.WalletInit, predicate: (state: FacadeState) => boolean, what: string) =>
  rx.firstValueFrom(
    wallet.wallet.state().pipe(
      rx.filter((state) => state.isSynced && predicate(state)),
      rx.timeout({
        first: syncTimeout,
        with: () => rx.throwError(() => new Error(`Timed out waiting for ${what}`)),
      }),
    ),
  );

/**
 * Registers the generator UTxO. A wallet with no Dust yet pays the registration fee out of the Dust the UTxO itself has
 * generated, so when that falls short the call is retried once generation is estimated to cover it.
 */
const registerGenerator = async (wallet: utils.WalletInit, generator: UtxoWithMeta): Promise<void> => {
  const register = () =>
    wallet.wallet.registerNightUtxosForDustGeneration(
      [generator],
      wallet.unshieldedKeystore.getPublicKey(),
      wallet.unshieldedKeystore.signDataAsync,
    );

  const recipe = await register().catch(async (error: unknown) => {
    if (!isInsufficientDustForFeeError(error)) throw error;
    if (error.estimate._tag !== 'Reachable') {
      throw new Error(
        `The ${generator.utxo.value} generator UTxO can never pay its own registration fee of ${error.fee} ` +
          `(${error.estimate.reason}); fund a larger generator`,
      );
    }
    logger.info(
      `Generator has ${error.claimableFeePayment} of the ${error.fee} Specks its registration costs; ` +
        `waiting about ${error.estimate.seconds}s for it to generate the rest`,
    );
    await wallet.wallet.waitForGeneratedDust([generator], error.fee, {
      timeoutMs: Number(error.estimate.seconds) * 1000 + 60_000,
    });
    return register();
  });

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  const txId = await wallet.wallet.submitTransaction(finalized);
  logger.info(`Dust registration submitted: ${txId}`);
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
    'tops a test wallet up to five Night UTxOs, Dust to pay fees with, and its shielded minimums',
    async () => {
      const before = await target.wallet.waitForSyncedState();
      const nightBefore = nightUtxosOf(before);
      const hasGenerator = nightBefore.some(isGenerator);
      const others = nightBefore.filter((coin) => !isGenerator(coin));
      const unregisteredOthers = others.filter((coin) => !coin.meta.registeredForDustGeneration);
      const baseCount = Math.max(
        0,
        MIN_NIGHT_UTXOS - 1 - others.length,
        MIN_UNREGISTERED_OTHERS - unregisteredOthers.length,
      );
      const nightAmounts = [
        ...(hasGenerator ? [] : [DUST_GENERATOR_AMOUNT]),
        ...Array.from({ length: baseCount }, () => BASE_AMOUNT),
      ];
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
      const generators = nightUtxosOf(funded).filter(isGenerator);
      expect(generators.length, 'No generator UTxO on the target wallet').toBeGreaterThan(0);
      // Registration is only needed to give the wallet Dust to pay fees with, so a wallet that already holds Dust is
      // left as it is, however its Night is registered.
      const dustBefore = dustOf(funded);
      if (dustBefore > 0n) {
        logger.info(`Target already holds ${dustBefore} Specks of Dust; not registering`);
      } else {
        const unregisteredGenerator = generators.find((coin) => !coin.meta.registeredForDustGeneration);
        if (unregisteredGenerator === undefined) {
          logger.info('Target has no Dust yet but its generator is already registered; waiting for it to generate');
        } else {
          await registerGenerator(target, unregisteredGenerator);
        }
        await waitForState(target, (state) => dustOf(state) > 0n, 'the target wallet to hold Dust');
      }

      const final = await target.wallet.waitForSyncedState();
      const nightFinal = nightUtxosOf(final);
      logger.info(
        nightFinal.map((coin) => `${coin.utxo.value} registered=${coin.meta.registeredForDustGeneration}`).join(', '),
      );
      expect(nightFinal.length).toBeGreaterThanOrEqual(MIN_NIGHT_UTXOS);
      logger.info(`Target Dust: ${dustOf(final)} Specks`);
      expect(dustOf(final), 'Target wallet holds no Dust').toBeGreaterThan(0n);
      expect(
        nightFinal.filter((coin) => !isGenerator(coin) && !coin.meta.registeredForDustGeneration).length,
      ).toBeGreaterThanOrEqual(MIN_UNREGISTERED_OTHERS);
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
