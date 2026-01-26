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
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed, getDustSeed, tokenValue } from './utils/index.js';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import {
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  createKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { makeProvingService } from './utils/proving.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 200_000 });

/**
 * TODO: Check dust spends instead of imbalance when refactoring to simulator
 */
const getImbalances = (
  tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  segmentIndex: number,
): { dust: bigint; shielded: bigint; unshielded: bigint } => {
  const imbalances = Array.from(tx.imbalances(segmentIndex));

  return imbalances.reduce(
    (acc, [tokenType, value]) => {
      acc[tokenType.tag] += value;

      return acc;
    },
    { dust: 0n, shielded: 0n, unshielded: 0n },
  );
};

/**
 * TODO: Replace docker environment with simulator once simulator is implemented
 */
describe('Optional Balancing', () => {
  const environmentId = randomUUID();

  const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
    additionalVars: {
      TESTCONTAINERS_UID: environmentId,
      RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
    },
  });

  const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml')
    .withWaitStrategy(
      `proof-server_${environmentId}`,
      Wait.forLogMessage('Actix runtime found; starting in Actix runtime'),
    )
    .withWaitStrategy(`node_${environmentId}`, Wait.forListeningPorts())
    .withWaitStrategy(`indexer_${environmentId}`, Wait.forLogMessage(/block indexed".*height":1,.*/gm))
    .withEnvironment(environmentVars)
    .withStartupTimeout(100_000);

  const ttl = new Date(Date.now() + 60 * 60 * 1000);

  const WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

  const shieldedSeed = getShieldedSeed(WALLET_SEED);
  const unshieldedSeed = getUnshieldedSeed(WALLET_SEED);
  const dustSeed = getDustSeed(WALLET_SEED);

  const unshieldedKeystore = createKeystore(unshieldedSeed, NetworkId.NetworkId.Undeployed);

  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeAll(async () => {
    startedEnvironment = await environment.up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql`,
        indexerWsUrl: `ws://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql/ws`,
      },
      provingServerUrl: new URL(
        `http://localhost:${startedEnvironment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(
        `ws://127.0.0.1:${startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`,
      ),
      networkId: NetworkId.NetworkId.Undeployed,
    };
  });

  afterAll(async () => {
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  let facade: WalletFacade;

  beforeEach(async () => {
    const Shielded = ShieldedWallet(configuration);
    const shieldedWallet = Shielded.startWithShieldedSeed(shieldedSeed);

    const Dust = DustWallet({
      ...configuration,
      costParameters: {
        additionalFeeOverhead: 400_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    });
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    const dustWallet = Dust.startWithSeed(dustSeed, dustParameters);

    const unshieldedWallet = UnshieldedWallet({
      ...configuration,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));

    facade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);

    await facade.start(ledger.ZswapSecretKeys.fromSeed(shieldedSeed), ledger.DustSecretKey.fromSeed(dustSeed));
  });

  afterEach(async () => {
    await facade.stop();
  });

  const shieldedTokenType = ledger.shieldedToken().raw;
  const unshieldedTokenType = ledger.unshieldedToken().raw;

  const createArbitraryTx = (networkId: NetworkId.NetworkId): ledger.UnprovenTransaction => {
    const coin = ledger.createShieldedCoinInfo(shieldedTokenType, tokenValue(1n));
    const zswapOutput = ledger.ZswapOutput.new(
      coin,
      0,
      ledger.sampleCoinPublicKey(),
      ledger.sampleEncryptionPublicKey(),
    );
    const zswapOutputOffer = ledger.ZswapOffer.fromOutput(zswapOutput, shieldedTokenType, tokenValue(1n));

    const unshieldedOutput = [
      {
        type: unshieldedTokenType,
        value: tokenValue(1n),
        owner: ledger.sampleUserAddress(),
      },
    ];
    const intent = ledger.Intent.new(new Date(Date.now() + 3600));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], unshieldedOutput, []);

    return ledger.Transaction.fromParts(networkId, zswapOutputOffer, undefined, intent);
  };

  describe('balanceUnprovenTransaction', () => {
    it('only balances shielded when tokenKindsToBalance is ["shielded"]', async () => {
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const recipe = await facade.balanceUnprovenTransaction(
        arbitraryTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['shielded'] },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify shielded IS balanced (imbalance = 0n)
      expect(imbalances.shielded).toEqual(0n);

      // Verify dust is NOT balanced (dust imbalance = 0n - no surplus)
      expect(imbalances.dust).toEqual(0n);

      // Verify unshielded is NOT balanced (unshielded imbalance < 0)
      expect(imbalances.unshielded).toBeLessThan(0n);
    });

    it('only balances unshielded when tokenKindsToBalance is ["unshielded"]', async () => {
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);

      const recipe = await facade.balanceUnprovenTransaction(
        arbitraryTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['unshielded'] },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify unshielded IS balanced (imbalance = 0n)
      expect(imbalances.unshielded).toBe(0n);

      // Verify dust is NOT balanced (dust imbalance = 0n - no surplus)
      expect(imbalances.dust).toEqual(0n);

      // Verify shielded is NOT balanced (imbalance < 0n)
      expect(imbalances.shielded).toBeLessThan(0n);
    });

    it('only adds dust fees when tokenKindsToBalance is ["dust"]', async () => {
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);

      const recipe = await facade.balanceUnprovenTransaction(
        arbitraryTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['dust'] },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify unshielded is NOT balanced (imbalance < 0n)
      expect(imbalances.unshielded).toBeLessThan(0n);

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(imbalances.dust).toBeGreaterThan(0n);

      // Verify shielded is NOT balanced (imbalance < 0n)
      expect(imbalances.shielded).toBeLessThan(0n);
    });

    it('balances all when tokenKindsToBalance is "all" (default)', async () => {
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const recipe = await facade.balanceUnprovenTransaction(
        arbitraryTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify unshielded IS balanced (imbalance = 0n)
      expect(imbalances.unshielded).toEqual(0n);

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(imbalances.dust).toBeGreaterThan(0n);

      // Verify shielded IS balanced (imbalance = 0n)
      expect(imbalances.shielded).toEqual(0n);
    });
  });

  describe('balanceUnboundTransaction', () => {
    it('only balances shielded when tokenKindsToBalance is ["shielded"]', async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['shielded'] },
      );

      // Verify balancing transaction exists (shielded balancing creates a balancing tx)
      expect(recipe.balancingTransaction).toBeDefined();

      const balancingImbalances = getImbalances(recipe.balancingTransaction!, 0);
      const baseImbalances = getImbalances(recipe.baseTransaction, 0);

      // Verify shielded IS balanced (provides surplus to offset base tx deficit)
      expect(balancingImbalances.shielded).toBeGreaterThan(0n);

      // Verify dust is NOT balanced (dust imbalance = 0n - no surplus)
      expect(balancingImbalances.dust).toEqual(0n);

      // Verify unshielded is NOT balanced (unshielded imbalance = 0n - no contribution)
      expect(balancingImbalances.unshielded).toEqual(0n);

      // Verify base tx unshielded is NOT balanced (unshielded imbalance < 0n)
      expect(baseImbalances.unshielded).toBeLessThan(0n);
    });

    it('only balances unshielded when tokenKindsToBalance is ["unshielded"]', async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['unshielded'] },
      );

      // Verify balancing transaction does NOT exist (unshielded balancing occurs in place)
      expect(recipe.balancingTransaction).toBeUndefined();

      const baseImbalances = getImbalances(recipe.baseTransaction, 0);

      // Verify base transaction IS balanced (unshielded = 0n)
      expect(baseImbalances.unshielded).toEqual(0n);
    });

    it('only adds dust fees when tokenKindsToBalance is ["dust"]', async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['dust'] },
      );

      // Verify balancing transaction exists with dust fees
      expect(recipe.balancingTransaction).toBeDefined();

      const balancingImbalances = getImbalances(recipe.balancingTransaction!, 0);

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(balancingImbalances.dust).toBeGreaterThan(0n);

      // Verify shielded is NOT balanced (shielded imbalance = 0n - no contribution)
      expect(balancingImbalances.shielded).toEqual(0n);

      // Verify unshielded is NOT balanced (unshielded imbalance = 0n - no contribution)
      expect(balancingImbalances.unshielded).toEqual(0n);

      const baseImbalances = getImbalances(recipe.baseTransaction, 0);

      // Verify base tx unshielded is NOT balanced (unshielded imbalance < 0n)
      expect(baseImbalances.unshielded).toBeLessThan(0n);
    });

    it('balances all when tokenKindsToBalance is "all" (default)', async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl },
      );

      // Verify balancing transaction exists
      expect(recipe.balancingTransaction).toBeDefined();

      const balancingImbalances = getImbalances(recipe.balancingTransaction!, 0);
      const baseImbalances = getImbalances(recipe.baseTransaction, 0);

      // Verify shielded IS balanced (provides surplus to offset base tx deficit)
      expect(balancingImbalances.shielded).toBeGreaterThan(0n);

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(balancingImbalances.dust).toBeGreaterThan(0n);

      // Verify unshielded is NOT balanced in balancingTransaction (unshielded imbalance = 0n)
      expect(balancingImbalances.unshielded).toBe(0n);

      // Verify unshielded IS balanced in baseTransaction (unshielded imbalance = 0n)
      expect(baseImbalances.unshielded).toBe(0n);
    });
  });

  describe('balanceFinalizedTransaction', () => {
    // create and prove only once to save computing time
    let finalizedTx: ledger.FinalizedTransaction;

    beforeAll(async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      finalizedTx = unboundTx.bind();
    });

    it('only balances shielded when tokenKindsToBalance is ["shielded"]', async () => {
      await facade.waitForSyncedState();

      // Balance the finalized transaction with only shielded
      const recipe = await facade.balanceFinalizedTransaction(
        finalizedTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['shielded'] },
      );

      const imbalances = getImbalances(recipe.balancingTransaction, 0);

      // Verify balancing transaction has shielded balancing (shielded imbalance > 0n - surplus)
      expect(imbalances.shielded).toBeGreaterThan(0n);

      // Verify dust is NOT balanced (no dust contribution, imbalance = 0)
      expect(imbalances.dust).toBe(0n);

      // Verify unshielded is NOT balanced (no unshielded contribution, imbalance = 0)
      expect(imbalances.unshielded).toBe(0n);
    });

    it('only balances unshielded when tokenKindsToBalance is ["unshielded"]', async () => {
      await facade.waitForSyncedState();

      // Balance the finalized transaction with only unshielded
      const recipe = await facade.balanceFinalizedTransaction(
        finalizedTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['unshielded'] },
      );

      const imbalances = getImbalances(recipe.balancingTransaction, 0);

      // Verify shielded is NOT balanced (no shielded contribution, imbalance = 0)
      expect(imbalances.shielded).toBe(0n);

      // Verify dust is NOT balanced (no dust contribution, imbalance = 0)
      expect(imbalances.dust).toBe(0n);

      // Verify unshielded is balanced (unshielded imbalance > 0)
      expect(imbalances.unshielded).toBeGreaterThan(0n);
    });

    it('only balances dust when tokenKindsToBalance is ["dust"]', async () => {
      await facade.waitForSyncedState();

      // Balance the finalized transaction with only dust
      const recipe = await facade.balanceFinalizedTransaction(
        finalizedTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['dust'] },
      );

      const imbalances = getImbalances(recipe.balancingTransaction, 0);

      // Verify shielded is NOT balanced (no shielded contribution, imbalance = 0)
      expect(imbalances.shielded).toBe(0n);

      // Verify dust IS balanced (dust imbalance > 0)
      expect(imbalances.dust).toBeGreaterThan(0n);

      // Verify unshielded is NOT balanced (no unshielded contribution, imbalance = 0)
      expect(imbalances.unshielded).toBe(0n);
    });

    it('balances all when tokenKindsToBalance is "all" (default)', async () => {
      await facade.waitForSyncedState();

      // Balance the finalized transaction with all
      const recipe = await facade.balanceFinalizedTransaction(
        finalizedTx,
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl },
      );

      const imbalances = getImbalances(recipe.balancingTransaction, 0);

      // Verify shielded is balanced (shielded imbalance > 0)
      expect(imbalances.shielded).toBeGreaterThan(0n);

      // Verify dust IS balanced (dust imbalance > 0)
      expect(imbalances.dust).toBeGreaterThan(0n);

      // Verify unshielded is balanced (unshielded contribution > 0)
      expect(imbalances.unshielded).toBeGreaterThan(0n);
    });
  });

  describe('initSwap', () => {
    it('does not pay fees when payFees is false', async () => {
      const { shielded: shieldedState } = await facade.waitForSyncedState();

      const recipe = await facade.initSwap(
        {
          shielded: {
            [shieldedTokenType]: tokenValue(1n),
          },
        },
        [
          {
            type: 'shielded',
            outputs: [
              {
                type: shieldedTokenType,
                receiverAddress: MidnightBech32m.encode('undeployed', shieldedState.address).toString(),
                amount: tokenValue(1n),
              },
            ],
          },
        ],
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, payFees: false },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify dust fees are NOT paid (dust imbalance = 0n)
      expect(imbalances.dust).toEqual(0n);
    });

    it('pays fees when payFees is true', async () => {
      const { shielded: shieldedState } = await facade.waitForSyncedState();

      const recipe = await facade.initSwap(
        {
          shielded: {
            [shieldedTokenType]: tokenValue(1n),
          },
        },
        [
          {
            type: 'shielded',
            outputs: [
              {
                type: shieldedTokenType,
                receiverAddress: MidnightBech32m.encode('undeployed', shieldedState.address).toString(),
                amount: tokenValue(1n),
              },
            ],
          },
        ],
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, payFees: true },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify dust fees ARE paid (dust imbalance > 0n)
      expect(imbalances.dust).toBeGreaterThan(0n);
    });
  });

  describe('transferTransaction', () => {
    it('does not pay fees when payFees is false', async () => {
      const { shielded: shieldedState } = await facade.waitForSyncedState();

      const recipe = await facade.transferTransaction(
        [
          {
            type: 'shielded',
            outputs: [
              {
                type: shieldedTokenType,
                receiverAddress: MidnightBech32m.encode('undeployed', shieldedState.address).toString(),
                amount: tokenValue(1n),
              },
            ],
          },
        ],
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, payFees: false },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify dust fees are NOT paid (dust imbalance = 0n)
      expect(imbalances.dust).toEqual(0n);
    });

    it('pays fees when payFees is true', async () => {
      const { shielded: shieldedState } = await facade.waitForSyncedState();

      const recipe = await facade.transferTransaction(
        [
          {
            type: 'shielded',
            outputs: [
              {
                type: shieldedTokenType,
                receiverAddress: MidnightBech32m.encode('undeployed', shieldedState.address).toString(),
                amount: tokenValue(1n),
              },
            ],
          },
        ],
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, payFees: true },
      );

      const imbalances = getImbalances(recipe.transaction, 0);

      // Verify dust fees ARE paid (dust imbalance > 0n)
      expect(imbalances.dust).toBeGreaterThan(0n);
    });
  });
});
