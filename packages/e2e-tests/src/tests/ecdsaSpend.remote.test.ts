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
//
// E2E (remote network) — full ECDSA-authorized unshielded spend (#402: ECDSA-SPEND-01/02),
// the remote-network counterpart of ecdsaSpend.undeployed.
//
// ECDSA addresses are net-new, so no faucet/genesis allocation funds them directly. The flow
// mirrors the undeployed test: the funded (schnorr) faucet wallet sends Night to the ECDSA
// wallet, the ECDSA wallet registers that Night for Dust generation (itself an ECDSA-authorized
// unshielded tx accepted by the chain), and then spends Night back — every unshielded
// authorization signed by the ECDSA keystore.
//
// Unlike the undeployed devnet, a remote chain is persistent, so a fixed ECDSA address would
// accumulate state across nightly runs and break the clean-wallet invariants below. Each run
// therefore derives a FRESH random ECDSA seed, guaranteeing an empty, fully unregistered wallet.
//
// Requires SEED (a funded faucet wallet) and NETWORK; the suite is skipped when SEED is unset so
// it can live in the standard `remote` project without aborting the run.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'node:crypto';
import * as rx from 'rxjs';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ArrayOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type CombinedTokenTransfer } from '@midnightntwrk/wallet-sdk-facade';
import { type TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as utils from './utils.js';
import { logger } from './logger.js';

const seedFunded = process.env['SEED'];

describe.skipIf(!seedFunded)('ECDSA unshielded spend (remote)', () => {
  const getFixture = useTestContainersFixture();
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  // The ECDSA wallet must self-fund its dust registration from the grace-period dust its single
  // funded Night UTxO projects. That fee (~0.3 DUST) is ~fixed regardless of UTxO size, and
  // generation rate scales with the Night amount, so the UTxO must be large to self-fund quickly:
  // ~35,900 / tNight seconds. 1000 tNight self-funds in ~36s; below ~600 tNight it exceeds the timeout.
  const fundingAmount = utils.tNightAmount(1000n);
  const spendAmount = utils.tNightAmount(100n);
  const timeout = 600_000;

  let fixture: TestContainersFixture;
  let funded: utils.WalletInit;
  let ecdsa: utils.WalletInit;

  beforeAll(async () => {
    fixture = getFixture();
    funded = await utils.initWalletWithSeed(seedFunded!, fixture); // faucet (schnorr)
    // Fresh ECDSA seed per run so the wallet always starts empty and fully unregistered.
    ecdsa = await utils.initWalletWithSeed(crypto.randomBytes(32).toString('hex'), fixture, 'ecdsa');
    logger.info('Funded (schnorr) and ECDSA wallets started');
  }, timeout);

  afterAll(async () => {
    await funded.wallet.stop();
    await ecdsa.wallet.stop();
  }, 20_000);

  // Fund the ECDSA wallet with Night from the faucet and register it for Dust so it can pay fees.
  // The registration is itself an ECDSA-authorized unshielded tx.
  const fundAndRegisterEcdsaWallet = async (): Promise<void> => {
    await funded.wallet.waitForSyncedState();
    const ecdsaInitial = await ecdsa.wallet.waitForSyncedState();
    const ecdsaInitialCoins = ecdsaInitial.unshielded.availableCoins.length;

    const outputs: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          { amount: fundingAmount, receiverAddress: ecdsaInitial.unshielded.address, type: unshieldedTokenRaw },
        ],
      },
    ];
    await utils.waitForBlockAdvancement(fixture.getIndexerUri());
    const fundingRecipe = await funded.wallet.transferTransaction(
      outputs,
      { shieldedSecretKeys: funded.shieldedSecretKeys, dustSecretKey: funded.dustSecretKey },
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );
    const signedFunding = await funded.wallet.signRecipe(fundingRecipe, (payload) =>
      funded.unshieldedKeystore.signData(payload),
    );
    logger.info('[diag] funding: proving + submitting...');
    await funded.wallet.submitTransaction(await funded.wallet.finalizeRecipe(signedFunding));
    logger.info('[diag] funding submitted; waiting for ECDSA wallet to receive Night...');

    // The ECDSA wallet receives the Night UTxO at its ECDSA address. Wait only for the unshielded
    // coin to appear — NOT full tri-wallet `isSynced`. On a live remote chain the node WS flaps
    // ("Normal Closure"), so the node-backed dust wallet's isConnected toggles and isSynced
    // (isStrictlyComplete = connected AND zero apply-gap across all three sub-wallets) rarely holds.
    // The coin's presence is the precise, stable signal this step needs.
    const afterFunding = await rx.firstValueFrom(
      ecdsa.wallet.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > ecdsaInitialCoins)),
    );
    const nightUtxos = afterFunding.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    expect(nightUtxos.length).toBeGreaterThan(0);
    expect(ArrayOps.sumBigInt(nightUtxos.map((coin) => coin.utxo.value))).toEqual(
      afterFunding.unshielded.balances[unshieldedTokenRaw],
    );

    // The ECDSA wallet has no Dust yet (dust only generates once Night is registered), so the
    // registration fee is covered by the Dust the Night UTxO itself projects during the
    // pre-registration grace period. Wait for that projection (drawn from a single guaranteed UTxO)
    // to reach the estimated fee before registering — signed by the ECDSA keystore.
    logger.info(
      `[diag] Night received: ${nightUtxos.length} UTxO(s), total ${afterFunding.unshielded.balances[unshieldedTokenRaw]}`,
    );
    const { fee: estimatedRegistrationFee } = await ecdsa.wallet.estimateRegistration(nightUtxos);
    const dustNow = (await rx.firstValueFrom(ecdsa.wallet.state())).dust.balance(new Date());
    logger.info(
      `[diag] registration fee=${estimatedRegistrationFee}, dust generated so far=${dustNow}; waiting for generation...`,
    );
    await ecdsa.wallet.waitForGeneratedDust(nightUtxos, estimatedRegistrationFee, { timeoutMs: 120_000 });
    logger.info('[diag] generated dust reached fee; submitting registration...');
    const registrationRecipe = await ecdsa.wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      ecdsa.unshieldedKeystore.getPublicKey(),
      (payload) => ecdsa.unshieldedKeystore.signData(payload),
    );
    const finalizedRegistration = await ecdsa.wallet.finalizeRecipe(registrationRecipe);
    await ecdsa.wallet.submitTransaction(finalizedRegistration);
    // Wait for the registration to apply: its tx is in history and the wallet now holds Dust.
    // Avoid an isSynced gate (see the funding wait above) — these two signals are sufficient and
    // stable on a live chain whose node connection flaps.
    await rx.firstValueFrom(
      ecdsa.wallet.state().pipe(
        rx.mergeMap(async (state) => ({
          state,
          txFound: (await ecdsa.wallet.queryTxHistoryByHash(finalizedRegistration.transactionHash())) !== undefined,
        })),
        rx.filter(({ state, txFound }) => txFound && state.dust.availableCoins.length > 0),
      ),
    );
    logger.info('ECDSA wallet funded with Night and registered for Dust');
  };

  test(
    'ECDSA-SPEND-01/02: an ECDSA wallet spends Night, authorized by its ECDSA key',
    async () => {
      await fundAndRegisterEcdsaWallet();

      // Wait for enough Dust to cover the spend's fee. A bare `> 0n` is not enough: the wallet
      // begins generating Dust the moment registration confirms, so it would pass almost
      // immediately with far too little to balance the spend, and transferTransaction would then
      // fail with "Insufficient Funds: could not balance dust". Wait for the established
      // "enough to transact" threshold.
      await utils.waitForDustBalance(ecdsa.wallet);

      const fundedState = await funded.wallet.waitForSyncedState();
      const initial = await ecdsa.wallet.waitForSyncedState();
      const initialNight = initial.unshielded.balances[unshieldedTokenRaw] ?? 0n;
      expect(initialNight).toBeGreaterThanOrEqual(spendAmount);

      const spendRecipe = await ecdsa.wallet.transferTransaction(
        [
          {
            type: 'unshielded',
            outputs: [
              { amount: spendAmount, receiverAddress: fundedState.unshielded.address, type: unshieldedTokenRaw },
            ],
          },
        ],
        { shieldedSecretKeys: ecdsa.shieldedSecretKeys, dustSecretKey: ecdsa.dustSecretKey },
        { ttl: new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signed = await ecdsa.wallet.signRecipe(spendRecipe, (payload) =>
        ecdsa.unshieldedKeystore.signData(payload),
      );
      const finalized = await ecdsa.wallet.finalizeRecipe(signed);
      const txId = await ecdsa.wallet.submitTransaction(finalized);
      logger.info(`ECDSA-authorized spend submitted, tx id: ${txId}`);

      // Wait for the spend to apply: the wallet's Night balance drops. No isSynced gate, so the
      // flapping node connection on the live chain can't stall the assertion.
      const finalState = await rx.firstValueFrom(
        ecdsa.wallet.state().pipe(rx.filter((s) => (s.unshielded.balances[unshieldedTokenRaw] ?? 0n) < initialNight)),
      );
      expect(finalState.unshielded.balances[unshieldedTokenRaw] ?? 0n).toBeLessThan(initialNight);

      // Best-effort cleanup: return the remaining Night to the faucet so each run doesn't strand the
      // funded amount on the throwaway ECDSA address. The spend assertion above has already passed,
      // so any failure here is logged, not fatal (the wallet keeps enough Dust to pay this tx's fee).
      try {
        await utils.waitForFacadePendingClear(ecdsa.wallet);
        const remaining = await rx.firstValueFrom(ecdsa.wallet.state());
        const remainingNight = remaining.unshielded.balances[unshieldedTokenRaw] ?? 0n;
        if (remainingNight > 0n) {
          const returnRecipe = await ecdsa.wallet.transferTransaction(
            [
              {
                type: 'unshielded',
                outputs: [
                  { amount: remainingNight, receiverAddress: fundedState.unshielded.address, type: unshieldedTokenRaw },
                ],
              },
            ],
            { shieldedSecretKeys: ecdsa.shieldedSecretKeys, dustSecretKey: ecdsa.dustSecretKey },
            { ttl: new Date(Date.now() + 30 * 60 * 1000) },
          );
          const signedReturn = await ecdsa.wallet.signRecipe(returnRecipe, (payload) =>
            ecdsa.unshieldedKeystore.signData(payload),
          );
          const returnTxId = await ecdsa.wallet.submitTransaction(await ecdsa.wallet.finalizeRecipe(signedReturn));
          logger.info(`Returned ${remainingNight} Night to the faucet, tx id: ${returnTxId}`);
        }
      } catch (err) {
        logger.warn(`Best-effort Night return to faucet failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    timeout,
  );
});
