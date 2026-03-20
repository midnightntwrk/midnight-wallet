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
 * Simulation Mode Test for WalletFacade
 *
 * This test demonstrates how to use the Simulator for wallet testing without
 * requiring a real blockchain node, proving server, or indexer.
 *
 * Key components:
 * 1. Simulator - provides a simulated ledger with block production
 * 2. Custom wallets with simulator-based sync capabilities
 * 3. Promise-based wrappers for submission and proving services
 *
 * This pattern is suitable for:
 * - Unit tests that need wallet functionality
 * - Integration tests that don't need real chain interaction
 * - DApp connector reference implementation tests
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CustomShieldedWallet, type ShieldedWalletAPI } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  Sync as ShieldedSync,
  Transacting as ShieldedTransacting,
  TransactionHistory,
  V1Builder as ShieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { CustomDustWallet, type DustWalletAPI } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  SyncService as DustSyncService,
  Transacting as DustTransacting,
  V1Builder as DustV1Builder,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import {
  CustomUnshieldedWallet,
  createKeystore,
  PublicKey,
  InMemoryTransactionHistoryStorage,
  type UnshieldedWalletAPI,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  Sync as UnshieldedSync,
  V1Builder as UnshieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet/v1';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as Submission from '@midnight-ntwrk/wallet-sdk-capabilities/submission';
import {
  makeSimulatorProvingServiceEffect,
  type ProvingService,
  type UnboundTransaction,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import { Simulator, type GenesisMint } from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import { Effect, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type CombinedTokenTransfer, WalletFacade, type UnprovenTransactionRecipe } from '../src/index.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, tokenValue } from './utils/index.js';
import type { SubmissionService } from '@midnight-ntwrk/wallet-sdk-capabilities';

vi.setConfig({ testTimeout: 30_000 }); // Fast tests - no real proving or network

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;
const NETWORK_ID = NetworkId.NetworkId.Undeployed;

const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const RECEIVER_SEED = '0000000000000000000000000000000000000000000000000000000000001111';

/**
 * Creates a Promise-based wrapper around the Effect-based simulator proving service.
 * Note: Uses type assertion because simulator proving returns ProofErasedTransaction
 * but facade expects UnboundTransaction - they are compatible at runtime.
 */
const createSimulatorProvingService = (): ProvingService<UnboundTransaction> => {
  const effectService = makeSimulatorProvingServiceEffect();
  return {
    prove: (tx: ledger.UnprovenTransaction) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
      effectService.prove(tx).pipe(Effect.runPromise) as any,
  };
};

/**
 * Creates a Promise-based wrapper around the Effect-based simulator submission service.
 * Note: Uses type assertions because simulator uses different transaction types internally.
 */
const createSimulatorSubmissionService = (simulator: Simulator): SubmissionService<ledger.FinalizedTransaction> => {
  const effectService = Submission.makeSimulatorSubmissionService<ledger.FinalizedTransaction>('InBlock')({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    simulator: simulator as any,
  });
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    submitTransaction: ((tx: ledger.FinalizedTransaction, waitFor?: 'Submitted' | 'InBlock' | 'Finalized') =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      effectService.submitTransaction(tx, waitFor ?? 'InBlock').pipe(Effect.runPromise)) as any,
    close: () => effectService.close().pipe(Effect.runPromise),
  };
};

describe('WalletFacade in simulation mode', () => {
  it('allows to transfer shielded tokens between two wallets', async () => {
    // Wrap entire test in Effect.gen with Effect.scoped to keep simulator resources alive
    return Effect.gen(function* () {
      // Step 1: Derive keys from seeds
      const shieldedSenderSeed = getShieldedSeed(SENDER_SEED);
      const shieldedReceiverSeed = getShieldedSeed(RECEIVER_SEED);
      const dustSenderSeed = getDustSeed(SENDER_SEED);
      const dustReceiverSeed = getDustSeed(RECEIVER_SEED);
      const unshieldedSenderSeed = getUnshieldedSeed(SENDER_SEED);
      const unshieldedReceiverSeed = getUnshieldedSeed(RECEIVER_SEED);

      const senderShieldedKeys = ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed);
      const receiverShieldedKeys = ledger.ZswapSecretKeys.fromSeed(shieldedReceiverSeed);
      const senderDustKey = ledger.DustSecretKey.fromSeed(dustSenderSeed);
      const receiverDustKey = ledger.DustSecretKey.fromSeed(dustReceiverSeed);

      const unshieldedSenderKeystore = createKeystore(unshieldedSenderSeed, NETWORK_ID);
      const unshieldedReceiverKeystore = createKeystore(unshieldedReceiverSeed, NETWORK_ID);

      const dustParameters = ledger.LedgerParameters.initialParameters().dust;

      // Step 2: Initialize Simulator with genesis mints (pre-funded accounts)
      const genesisMints: [GenesisMint] = [
        {
          amount: tokenValue(1000n),
          type: shieldedTokenType,
          recipient: senderShieldedKeys,
        },
      ];

      // yield* keeps the simulator scope alive throughout the Effect
      const simulator = yield* Simulator.init({ mode: 'genesis', genesisMints });

      // Step 3: Create wallet factories with simulator-based capabilities
      const simulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      // Shielded wallet factory with simulator capabilities
      const ShieldedWalletFactory = CustomShieldedWallet(
        simulatorConfig,
        new ShieldedV1Builder()
          .withTransactionType<ledger.FinalizedTransaction>()
          .withCoinSelectionDefaults()
          .withTransacting(ShieldedTransacting.makeSimulatorTransactingCapability)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
          .withTransactionHistory(TransactionHistory.makeSimulatorTransactionHistoryCapability as any)
          .withSync(ShieldedSync.makeSimulatorSyncService, ShieldedSync.makeSimulatorSyncCapability)
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withSerializationDefaults(),
      );

      // Dust wallet factory with simulator capabilities
      const DustWalletFactory = CustomDustWallet(
        simulatorConfig,
        new DustV1Builder()
          .withTransactionType<ledger.FinalizedTransaction>()
          .withCoinSelectionDefaults()
          .withTransacting(DustTransacting.makeSimulatorTransactingCapability)
          .withSync(DustSyncService.makeSimulatorSyncService, DustSyncService.makeSimulatorSyncCapability)
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withSerializationDefaults(),
      );

      // Unshielded wallet factory with simulator capabilities
      const UnshieldedWalletFactory = CustomUnshieldedWallet(
        { ...simulatorConfig, txHistoryStorage: new InMemoryTransactionHistoryStorage() },
        new UnshieldedV1Builder()
          .withCoinSelectionDefaults()
          .withTransactingDefaults()
          .withSync(UnshieldedSync.makeSimulatorSyncService, UnshieldedSync.makeSimulatorSyncCapability)
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withSerializationDefaults()
          .withTransactionHistoryDefaults(),
      );

      // Step 4: Create Promise-based simulator services for proving and submission
      const provingService = createSimulatorProvingService();
      const submissionService = createSimulatorSubmissionService(simulator);

      // Step 5: Initialize WalletFacades for sender and receiver
      // Cast wallets to their API types since the facade expects the default types
      const senderFacade = yield* Effect.promise(() =>
        WalletFacade.init({
          configuration: {
            ...simulatorConfig,
            // Dummy values - not used in simulation mode
            indexerClientConnection: { indexerHttpUrl: 'http://unused' },
            relayURL: new URL('ws://unused'),
            txHistoryStorage: new InMemoryTransactionHistoryStorage(),
          },
          shielded: () => ShieldedWalletFactory.startWithSecretKeys(senderShieldedKeys) as unknown as ShieldedWalletAPI,
          unshielded: () =>
            UnshieldedWalletFactory.startWithPublicKey(
              PublicKey.fromKeyStore(unshieldedSenderKeystore),
            ) as unknown as UnshieldedWalletAPI,
          dust: () => DustWalletFactory.startWithSecretKey(senderDustKey, dustParameters) as unknown as DustWalletAPI,
          provingService: () => provingService,
          submissionService: () => submissionService,
        }),
      );

      const receiverFacade = yield* Effect.promise(() =>
        WalletFacade.init({
          configuration: {
            ...simulatorConfig,
            indexerClientConnection: { indexerHttpUrl: 'http://unused' },
            relayURL: new URL('ws://unused'),
            txHistoryStorage: new InMemoryTransactionHistoryStorage(),
          },
          shielded: () =>
            ShieldedWalletFactory.startWithSecretKeys(receiverShieldedKeys) as unknown as ShieldedWalletAPI,
          unshielded: () =>
            UnshieldedWalletFactory.startWithPublicKey(
              PublicKey.fromKeyStore(unshieldedReceiverKeystore),
            ) as unknown as UnshieldedWalletAPI,
          dust: () => DustWalletFactory.startWithSecretKey(receiverDustKey, dustParameters) as unknown as DustWalletAPI,
          provingService: () => provingService,
          submissionService: () => submissionService,
        }),
      );

      // Step 6: Start the wallets
      yield* Effect.promise(() =>
        Promise.all([
          senderFacade.start(senderShieldedKeys, senderDustKey),
          receiverFacade.start(receiverShieldedKeys, receiverDustKey),
        ]),
      );

      // Step 7: Wait for sender wallet to sync and see the genesis funds
      yield* Effect.promise(() =>
        pipe(
          senderFacade.state(),
          rx.filter((s) => s.shielded.availableCoins.length > 0),
          rx.firstValueFrom,
        ),
      );

      // Step 8: Get receiver address
      const receiverAddress = yield* Effect.promise(() => receiverFacade.shielded.getAddress());

      // Step 9: Create and submit a transfer transaction
      const ttl = new Date(Date.now() + 60 * 60 * 1000);
      const transferOutputs: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenType,
              receiverAddress,
              amount: tokenValue(42n),
            },
          ],
        },
      ];

      const transferRecipe: UnprovenTransactionRecipe = yield* Effect.promise(() =>
        senderFacade.transferTransaction(
          transferOutputs,
          {
            shieldedSecretKeys: senderShieldedKeys,
            dustSecretKey: senderDustKey,
          },
          { ttl, payFees: false }, // No fees in simulation mode without dust registration
        ),
      );

      const finalizedTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(transferRecipe));
      const txHash = yield* Effect.promise(() => senderFacade.submitTransaction(finalizedTx));

      expect(txHash).toBeTypeOf('string');

      // Step 10: Wait for receiver wallet to see the transferred funds
      const finalBalance = yield* Effect.promise(() =>
        pipe(
          receiverFacade.state(),
          rx.filter((state) => state.shielded.availableCoins.length > 0),
          rx.map((state) => state.shielded.balances[shieldedTokenType] ?? 0n),
          rx.firstValueFrom,
        ),
      );

      expect(finalBalance).toEqual(tokenValue(42n));

      // Cleanup
      yield* Effect.promise(() => Promise.all([senderFacade.stop(), receiverFacade.stop()]));
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
