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
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Simulator, type GenesisMint } from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import { Effect, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type CombinedTokenTransfer, type UnprovenTransactionRecipe } from '../src/index.js';
import {
  createSimulatorProvingService,
  createSimulatorSubmissionService,
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  tokenValue,
  waitForShieldedCoins,
  type SimulatorConfig,
} from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 }); // Fast tests - no real proving or network

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;
const NETWORK_ID = NetworkId.NetworkId.Undeployed;

const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const RECEIVER_SEED = '0000000000000000000000000000000000000000000000000000000000001111';

describe('WalletFacade in simulation mode', () => {
  it('allows to transfer shielded tokens between two wallets', async () => {
    // Wrap entire test in Effect.gen with Effect.scoped to keep simulator resources alive
    // and automatically clean up facades when the scope closes
    return Effect.gen(function* () {
      // Step 1: Derive keys from seeds
      const senderKeys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const receiverKeys = deriveWalletKeys(RECEIVER_SEED, NETWORK_ID);

      // Step 2: Initialize Simulator with genesis mints (pre-funded accounts)
      const genesisMints: [GenesisMint] = [
        {
          type: 'shielded',
          tokenType: shieldedTokenType,
          amount: tokenValue(1000n),
          recipient: senderKeys.shieldedKeys,
        },
      ];

      const simulator = yield* Simulator.init({ genesisMints });

      // Step 3: Create simulator services and wallet factories
      const simulatorConfig: SimulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      const provingService = createSimulatorProvingService();
      const submissionService = createSimulatorSubmissionService(simulator);
      const factories = createSimulatorWalletFactories(simulatorConfig);

      // Step 4: Initialize WalletFacades for sender and receiver
      // Using Effect.acquireRelease ensures facades are stopped when scope closes
      const senderFacade = yield* makeSimulatorFacade(
        simulatorConfig,
        senderKeys,
        factories,
        provingService,
        submissionService,
      );

      const receiverFacade = yield* makeSimulatorFacade(
        simulatorConfig,
        receiverKeys,
        factories,
        provingService,
        submissionService,
      );

      // Step 5: Wait for sender wallet to sync and see the genesis funds
      yield* waitForShieldedCoins(senderFacade);

      // Step 6: Get receiver address and create transfer
      const receiverAddress = yield* Effect.promise(() => receiverFacade.shielded.getAddress());

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

      // Step 7: Create, finalize, and submit the transfer transaction
      const transferRecipe: UnprovenTransactionRecipe = yield* Effect.promise(() =>
        senderFacade.transferTransaction(
          transferOutputs,
          {
            shieldedSecretKeys: senderKeys.shieldedKeys,
            dustSecretKey: senderKeys.dustKey,
          },
          { ttl, payFees: false }, // No fees in simulation mode without dust registration
        ),
      );

      const finalizedTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(transferRecipe));
      const txHash = yield* Effect.promise(() => senderFacade.submitTransaction(finalizedTx));

      expect(txHash).toBeTypeOf('string');

      // Step 8: Wait for receiver wallet to see the transferred funds
      const finalBalance = yield* Effect.promise(() =>
        pipe(
          receiverFacade.state(),
          rx.filter((state) => state.shielded.availableCoins.length > 0),
          rx.map((state) => state.shielded.balances[shieldedTokenType] ?? 0n),
          rx.firstValueFrom,
        ),
      );

      expect(finalBalance).toEqual(tokenValue(42n));

      // Cleanup is automatic via Effect.scoped - facades are stopped when scope closes
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  // TODO: Night token transfers need further investigation
  // The unshielded wallet sync for Night tokens from genesis is not working as expected.
  // This is a known issue tracked in simulator_refactor.md Task 23.
  it.skip('supports Night tokens in genesis and unshielded transfers', async () => {
    return Effect.gen(function* () {
      // Derive keys
      const senderKeys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const receiverKeys = deriveWalletKeys(RECEIVER_SEED, NETWORK_ID);

      // Night token type is the native token
      const nightTokenType = ledger.nativeToken().raw;

      // Initialize Simulator with Night genesis mint
      // Night requires verifyingKey for the claim transaction
      const genesisMints: [GenesisMint] = [
        {
          type: 'unshielded',
          tokenType: nightTokenType,
          amount: tokenValue(1000n), // Must exceed minimum claim amount (~14077)
          recipient: senderKeys.userAddress,
          verifyingKey: senderKeys.signatureVerifyingKey,
        },
      ];

      const simulator = yield* Simulator.init({ genesisMints });

      // Create simulator services and wallet factories
      const simulatorConfig: SimulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      const provingService = createSimulatorProvingService();
      const submissionService = createSimulatorSubmissionService(simulator);
      const factories = createSimulatorWalletFactories(simulatorConfig);

      // Initialize facades
      const senderFacade = yield* makeSimulatorFacade(
        simulatorConfig,
        senderKeys,
        factories,
        provingService,
        submissionService,
      );

      const receiverFacade = yield* makeSimulatorFacade(
        simulatorConfig,
        receiverKeys,
        factories,
        provingService,
        submissionService,
      );

      // Wait for sender to see Night balance
      const senderBalance = yield* Effect.promise(() =>
        pipe(
          senderFacade.state(),
          rx.map((s) => s.unshielded.balances[nightTokenType] ?? 0n),
          rx.filter((balance) => balance > 0n),
          rx.firstValueFrom,
        ),
      );

      expect(senderBalance).toEqual(tokenValue(1000n));

      // Get receiver address for Night transfer
      const receiverAddress = yield* Effect.promise(() => receiverFacade.unshielded.getAddress());

      // Create Night transfer
      const ttl = new Date(Date.now() + 60 * 60 * 1000);
      const transferOutputs: CombinedTokenTransfer[] = [
        {
          type: 'unshielded',
          outputs: [
            {
              type: nightTokenType,
              receiverAddress,
              amount: tokenValue(100n),
            },
          ],
        },
      ];

      const transferRecipe: UnprovenTransactionRecipe = yield* Effect.promise(() =>
        senderFacade.transferTransaction(
          transferOutputs,
          {
            shieldedSecretKeys: senderKeys.shieldedKeys,
            dustSecretKey: senderKeys.dustKey,
          },
          { ttl, payFees: false },
        ),
      );

      const finalizedTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(transferRecipe));
      const txHash = yield* Effect.promise(() => senderFacade.submitTransaction(finalizedTx));

      expect(txHash).toBeTypeOf('string');

      // Wait for receiver to see Night balance
      const receiverBalance = yield* Effect.promise(() =>
        pipe(
          receiverFacade.state(),
          rx.map((s) => s.unshielded.balances[nightTokenType] ?? 0n),
          rx.filter((balance) => balance > 0n),
          rx.firstValueFrom,
        ),
      );

      expect(receiverBalance).toEqual(tokenValue(100n));
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
