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
import { TokenKindsToBalance, WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { makeProvingService } from './utils/proving.js';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 200_000 });

const getImbalance = (
  tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  segmentIndex: number,
  tokenType: 'shielded' | 'unshielded' | 'dust',
): bigint | undefined => {
  const [, value] = Array.from(tx.imbalances(segmentIndex)).find(([t, value]) =>
    t.tag == tokenType ? value : undefined,
  ) ?? [undefined, BigInt(0)];

  return value;
};

describe('TokenKindsToBalance.toFlags', () => {
  it('returns all flags true for "all"', () => {
    const flags = TokenKindsToBalance.toFlags('all');
    expect(flags).toEqual({
      shouldBalanceUnshielded: true,
      shouldBalanceShielded: true,
      shouldBalanceDust: true,
    });
  });

  it('returns only shielded flag for ["shielded"]', () => {
    const flags = TokenKindsToBalance.toFlags(['shielded']);
    expect(flags).toEqual({
      shouldBalanceUnshielded: false,
      shouldBalanceShielded: true,
      shouldBalanceDust: false,
    });
  });

  it('returns only unshielded flag for ["unshielded"]', () => {
    const flags = TokenKindsToBalance.toFlags(['unshielded']);
    expect(flags).toEqual({
      shouldBalanceUnshielded: true,
      shouldBalanceShielded: false,
      shouldBalanceDust: false,
    });
  });

  it('returns only dust flag for ["dust"]', () => {
    const flags = TokenKindsToBalance.toFlags(['dust']);
    expect(flags).toEqual({
      shouldBalanceUnshielded: false,
      shouldBalanceShielded: false,
      shouldBalanceDust: true,
    });
  });
});

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

  // Helper to create arbitrary shielded output transaction (creates shielded imbalance)
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
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['shielded'] },
      );

      // Verify shielded IS balanced (imbalance = 0n)
      expect(getImbalance(recipe.transaction, 0, 'shielded')).toEqual(0n);

      // Verify dust is NOT balanced (dust imbalance = 0n - no surplus)
      expect(getImbalance(recipe.transaction, 0, 'dust')).toEqual(0n);

      // Verify unshielded is NOT balanced (unshielded imbalance < 0)
      expect(getImbalance(recipe.transaction, 0, 'unshielded')).toBeLessThan(0n);
    });

    it('only balances unshielded when tokenKindsToBalance is ["unshielded"]', async () => {
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);

      const recipe = await facade.balanceUnprovenTransaction(
        arbitraryTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['unshielded'] },
      );

      // Verify unshielded IS balanced (imbalance = 0n)
      expect(getImbalance(recipe.transaction, 0, 'unshielded')).toBe(0n);

      // Verify dust is NOT balanced (dust imbalance = 0n - no surplus)
      expect(getImbalance(recipe.transaction, 0, 'dust')).toEqual(0n);

      // Verify shielded is NOT balanced (imbalance < 0n)
      expect(getImbalance(recipe.transaction, 0, 'shielded')).toBeLessThan(0n);
    });

    it('only adds dust fees when tokenKindsToBalance is ["dust"]', async () => {
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);

      const recipe = await facade.balanceUnprovenTransaction(
        arbitraryTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['dust'] },
      );

      // Verify unshielded is NOT balanced (imbalance < 0n)
      expect(getImbalance(recipe.transaction, 0, 'unshielded')).toBeLessThan(0n);

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(getImbalance(recipe.transaction, 0, 'dust')).toBeGreaterThan(0n);

      // Verify shielded is NOT balanced (imbalance < 0n)
      expect(getImbalance(recipe.transaction, 0, 'shielded')).toBeLessThan(0n);
    });

    it('balances all when tokenKindsToBalance is "all" (default)', async () => {
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const recipe = await facade.balanceUnprovenTransaction(
        arbitraryTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl },
      );

      // Verify unshielded IS balanced (imbalance = 0n)
      expect(getImbalance(recipe.transaction, 0, 'unshielded')).toEqual(0n);

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(getImbalance(recipe.transaction, 0, 'dust')).toBeGreaterThan(0n);

      // Verify shielded IS balanced (imbalance = 0n)
      expect(getImbalance(recipe.transaction, 0, 'shielded')).toEqual(0n);
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
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['shielded'] },
      );

      // Verify balancing transaction exists (shielded balancing creates a balancing tx)
      expect(recipe.balancingTransaction).toBeDefined();

      // Verify shielded IS balanced (provides surplus to offset base tx deficit)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'shielded')).toBeGreaterThan(0n);

      // Verify dust is NOT balanced (dust imbalance = 0n - no surplus)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'dust')).toEqual(0n);

      // Verify unshielded is NOT balanced (unshielded imbalance = 0n - no contribution)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'unshielded')).toEqual(0n);

      // Verify base tx unshielded is NOT balanced (unshielded imbalance < 0n)
      expect(getImbalance(recipe.baseTransaction, 0, 'unshielded')).toBeLessThan(0n);
    });

    it('only balances unshielded when tokenKindsToBalance is ["unshielded"]', async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['unshielded'] },
      );

      // Verify balancing transaction does NOT exist (unshielded balancing occurs in place)
      expect(recipe.balancingTransaction).toBeUndefined();

      // Verify base transaction IS balanced (unshielded = 0n)
      expect(getImbalance(recipe.baseTransaction, 0, 'unshielded')).toEqual(0n);
    });

    it('only adds dust fees when tokenKindsToBalance is ["dust"]', async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['dust'] },
      );

      // Verify balancing transaction exists with dust fees
      expect(recipe.balancingTransaction).toBeDefined();

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'dust')).toBeGreaterThan(0n);

      // Verify shielded is NOT balanced (shielded imbalance = 0n - no contribution)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'shielded')).toEqual(0n);

      // Verify unshielded is NOT balanced (unshielded imbalance = 0n - no contribution)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'unshielded')).toEqual(0n);

      // Verify base tx unshielded is NOT balanced (unshielded imbalance < 0n)
      expect(getImbalance(recipe.baseTransaction, 0, 'unshielded')).toBeLessThan(0n);
    });

    it('balances all when tokenKindsToBalance is "all" (default)', async () => {
      const provingService = makeProvingService(configuration.provingServerUrl);
      await facade.waitForSyncedState();

      const arbitraryTx = createArbitraryTx(configuration.networkId);
      const unboundTx = await provingService.proveTransaction(arbitraryTx);

      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl },
      );

      // Verify balancing transaction exists
      expect(recipe.balancingTransaction).toBeDefined();

      // Verify shielded IS balanced (provides surplus to offset base tx deficit)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'shielded')).toBeGreaterThan(0n);

      // Verify dust IS balanced (dust imbalance > 0n - surplus)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'dust')).toBeGreaterThan(0n);

      // Verify unshielded is NOT balanced in balancingTransaction (unshielded imbalance = 0n)
      expect(getImbalance(recipe.balancingTransaction!, 0, 'unshielded')).toBe(0n);

      // Verify unshielded IS balanced in baseTransaction (unshielded imbalance = 0n)
      expect(getImbalance(recipe.baseTransaction, 0, 'unshielded')).toBe(0n);
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
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['shielded'] },
      );

      // Verify balancing transaction has shielded balancing (shielded imbalance > 0n - surplus)
      expect(getImbalance(recipe.balancingTransaction, 0, 'shielded')).toBeGreaterThan(0n);

      // Verify dust is NOT balanced (no dust contribution, imbalance = 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'dust')).toBe(0n);

      // Verify unshielded is NOT balanced (no unshielded contribution, imbalance = 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'unshielded')).toBe(0n);
    });

    it('only balances unshielded when tokenKindsToBalance is ["unshielded"]', async () => {
      await facade.waitForSyncedState();

      // Balance the finalized transaction with only unshielded
      const recipe = await facade.balanceFinalizedTransaction(
        finalizedTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['unshielded'] },
      );

      // Verify shielded is NOT balanced (no shielded contribution, imbalance = 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'shielded')).toBe(0n);

      // Verify dust is NOT balanced (no dust contribution, imbalance = 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'dust')).toBe(0n);

      // Verify unshielded is balanced (unshielded imbalance > 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'unshielded')).toBeGreaterThan(0n);
    });

    it('only balances dust when tokenKindsToBalance is ["dust"]', async () => {
      await facade.waitForSyncedState();

      // Balance the finalized transaction with only dust
      const recipe = await facade.balanceFinalizedTransaction(
        finalizedTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl, tokenKindsToBalance: ['dust'] },
      );

      // Verify shielded is NOT balanced (no shielded contribution, imbalance = 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'shielded')).toBe(0n);

      // Verify dust IS balanced (dust imbalance > 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'dust')).toBeGreaterThan(0n);

      // Verify unshielded is NOT balanced (no unshielded contribution, imbalance = 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'unshielded')).toBe(0n);
    });

    it('balances all when tokenKindsToBalance is "all" (default)', async () => {
      await facade.waitForSyncedState();

      // Balance the finalized transaction with all
      const recipe = await facade.balanceFinalizedTransaction(
        finalizedTx,
        {
          zswapSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSeed),
        },
        { ttl },
      );

      // Verify shielded is balanced (shielded imbalance > 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'shielded')).toBeGreaterThan(0n);

      // Verify dust IS balanced (dust imbalance > 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'dust')).toBeGreaterThan(0n);

      // Verify unshielded is balanced (unshielded contribution > 0)
      expect(getImbalance(recipe.balancingTransaction, 0, 'unshielded')).toBeGreaterThan(0n);
    });
  });
});
