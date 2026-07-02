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
// E2E (§9, local devnet) — full ECDSA-authorized unshielded spend plus
// end-to-end scheme-mismatch rejection (#402: ECDSA-SPEND-01/02, ECDSA-MM-07).
//
// ECDSA addresses are net-new, so the genesis allocation does not fund them. The
// flow mirrors dust.undeployed: the genesis (schnorr) wallet funds the ECDSA
// wallet with Night, the ECDSA wallet registers it for Dust generation (already
// an ECDSA-authorized unshielded operation accepted by the chain), and then spends
// Night — every unshielded authorization signed by the ECDSA keystore. Schnorr
// unshielded spends (ECDSA-SPEND-03) stay covered by tokenTransfer.undeployed.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as rx from 'rxjs';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ArrayOps } from '@midnightntwrk/wallet-sdk-utilities';
import { createKeystore } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { type CombinedTokenTransfer } from '@midnightntwrk/wallet-sdk-facade';
import { type TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as utils from './utils.js';
import { logger } from './logger.js';

describe('ECDSA unshielded spend (undeployed)', () => {
  const getFixture = useTestContainersFixture();
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  // fundAndRegisterEcdsaWallet asserts clean-wallet invariants: the funded UTxOs are the wallet's
  // only Night and are all unregistered. Every test in this file shares one persistent devnet, so
  // the tests must NOT share an ECDSA address — otherwise the second test inherits the first's
  // registered coins and those invariants no longer hold (the funding wait snapshots a still-
  // settling registered leftover and the unregistered filter yields zero). Give each test its own
  // ECDSA seed so it always starts from an empty, fully unregistered wallet.
  const ecdsaSpendSeed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const ecdsaMismatchSeed = '42ea72a851a1b6ca65ce29e2143d6bc85401fce387af78fb0256d07a5629ac5c';
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const fundingAmount = utils.tNightAmount(1000n);
  const spendAmount = utils.tNightAmount(100n);
  const timeout = 600_000;

  let fixture: TestContainersFixture;
  let funded: utils.WalletInit;
  // Created per test (with a per-test seed); tracked here only so afterEach can stop it.
  let activeEcdsa: utils.WalletInit | undefined;

  beforeEach(async () => {
    fixture = getFixture();
    funded = await utils.initWalletWithSeed(seedFunded, fixture); // genesis (schnorr)
    activeEcdsa = undefined;
    logger.info('Funded (schnorr) wallet started');
  });

  afterEach(async () => {
    await funded.wallet.stop();
    await activeEcdsa?.wallet.stop();
  }, 20_000);

  // Fund the ECDSA wallet with Night from genesis and register it for Dust so it
  // can pay fees. The registration is itself an ECDSA-authorized unshielded tx.
  const fundAndRegisterEcdsaWallet = async (ecdsa: utils.WalletInit): Promise<void> => {
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
    const signedFunding = await funded.wallet.signRecipe(fundingRecipe, funded.unshieldedKeystore.signDataAsync);
    await funded.wallet.submitTransaction(await funded.wallet.finalizeRecipe(signedFunding));

    // The ECDSA wallet receives the Night UTxOs at its ECDSA address.
    const afterFunding = await utils.waitForUnshieldedCoinUpdate(ecdsa.wallet, ecdsaInitialCoins);
    const nightUtxos = afterFunding.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    expect(nightUtxos.length).toBeGreaterThan(0);
    expect(ArrayOps.sumBigInt(nightUtxos.map((coin) => coin.utxo.value))).toEqual(
      afterFunding.unshielded.balances[unshieldedTokenRaw],
    );

    // Register the Night UTxOs for Dust generation — signed by the ECDSA keystore.
    const { fee: estimatedRegistrationFee } = await ecdsa.wallet.estimateRegistration(nightUtxos);
    await ecdsa.wallet.waitForGeneratedDust(nightUtxos, estimatedRegistrationFee);
    const registrationRecipe = await ecdsa.wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      ecdsa.unshieldedKeystore.getPublicKey(),
      ecdsa.unshieldedKeystore.signDataAsync,
    );
    const finalizedRegistration = await ecdsa.wallet.finalizeRecipe(registrationRecipe);
    await ecdsa.wallet.submitTransaction(finalizedRegistration);
    await utils.waitForStateAfterDustRegistration(ecdsa.wallet, finalizedRegistration);
    logger.info('ECDSA wallet funded with Night and registered for Dust');
  };

  test(
    'ECDSA-SPEND-01/02: an ECDSA wallet spends Night, authorized by its ECDSA key',
    async () => {
      const ecdsa = (activeEcdsa = await utils.initWalletWithSeed(ecdsaSpendSeed, fixture, 'ecdsa'));
      logger.info('ECDSA (spend) wallet started');
      await fundAndRegisterEcdsaWallet(ecdsa);

      // Wait for enough Dust to cover the spend's fee. A bare `> 0n` is not enough: the wallet
      // begins generating Dust the moment registration confirms, so `> 0n` passes almost
      // immediately with far too little to balance the spend, and transferTransaction then fails
      // with "Insufficient Funds: could not balance dust". Mirror the sibling Dust spend tests and
      // wait for the established "enough to transact" threshold (> 7 * 10^14).
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
      const signed = await ecdsa.wallet.signRecipe(spendRecipe, ecdsa.unshieldedKeystore.signDataAsync);
      const finalized = await ecdsa.wallet.finalizeRecipe(signed);
      const txId = await ecdsa.wallet.submitTransaction(finalized);
      logger.info(`ECDSA-authorized spend submitted, tx id: ${txId}`);

      const finalState = await rx.firstValueFrom(
        ecdsa.wallet.state().pipe(
          rx.filter((s) => s.isSynced),
          rx.filter((s) => (s.unshielded.balances[unshieldedTokenRaw] ?? 0n) < initialNight),
        ),
      );
      expect(finalState.unshielded.balances[unshieldedTokenRaw] ?? 0n).toBeLessThan(initialNight);
    },
    timeout,
  );

  test(
    'ECDSA-MM-07: a Schnorr signature for the ECDSA wallet is rejected before submission',
    async () => {
      const ecdsa = (activeEcdsa = await utils.initWalletWithSeed(ecdsaMismatchSeed, fixture, 'ecdsa'));
      logger.info('ECDSA (mismatch) wallet started');
      await fundAndRegisterEcdsaWallet(ecdsa);

      // Build the spend recipe under the same healthy-Dust precondition as the spend test above.
      // transferTransaction balances its fee in Dust; doing so against barely-generated Dust leaves
      // the fee-convergence loop unable to settle (observed as a long spin ending in a ledger-wasm
      // "unreachable" panic in dust Transacting). Wait for the established threshold so the recipe
      // build is well-behaved and signRecipe is what rejects the scheme mismatch.
      await utils.waitForDustBalance(ecdsa.wallet);

      // A schnorr keystore over the same seed — the wrong scheme for this wallet.
      const wrongSchemeKeystore = createKeystore(
        { kind: 'schnorr', secret: utils.getUnshieldedSeed(ecdsaMismatchSeed) },
        fixture.getNetworkId(),
      );
      const fundedState = await funded.wallet.waitForSyncedState();
      const recipe = await ecdsa.wallet.transferTransaction(
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

      // signRecipe must reject the scheme mismatch before finalize/submit — nothing reaches the chain.
      await expect(ecdsa.wallet.signRecipe(recipe, wrongSchemeKeystore.signDataAsync)).rejects.toThrow(/scheme/i);
    },
    timeout,
  );
});

// ECDSA-F-01 / ECDSA-S-01 — connector `signData` with keyType 'ecdsa' end-to-end
// (prefix present, not replayable as a tx signature). BLOCKED on
// midnight-dapp-connector-api#31 (the connector exposes no ecdsa keyType yet).
describe.skip('ECDSA connector signData (undeployed) — blocked on dapp-connector-api#31', () => {
  test('ECDSA-F-01/S-01: signData keyType ecdsa, prefixed and non-replayable', () => {
    // Enable once the connector exposes keyType: 'ecdsa'.
  });
});
