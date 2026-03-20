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
 * Simulation Mode Test
 *
 * This test demonstrates how to use the Simulator for wallet testing without
 * requiring a real blockchain node, proving server, or indexer.
 *
 * Key components:
 * 1. Simulator - provides a simulated ledger with block production
 * 2. makeSimulatorProvingServiceEffect - bypasses ZK proving (instant)
 * 3. makeSimulatorSubmissionService - submits to simulator instead of node
 * 4. makeSimulatorSyncService/Capability - syncs wallet state from simulator
 * 5. makeSimulatorTransactingCapability - creates transactions for simulator
 *
 * This pattern is suitable for:
 * - Unit tests that need wallet functionality
 * - Integration tests that don't need real chain interaction
 * - DApp connector reference implementation tests
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CustomShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as Submission from '@midnight-ntwrk/wallet-sdk-capabilities/submission';
import { makeSimulatorProvingServiceEffect } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import { Simulator, type GenesisMint } from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import { Sync, Transacting, TransactionHistory, V1Builder } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { Effect, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 10_000 }); // Fast tests - no real proving or network

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;

describe('Working in simulation mode', () => {
  it('allows to make transactions', async () => {
    return Effect.gen(function* () {
      const senderKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const receiverKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));

      // Step 1: Initialize Simulator with genesis mints (pre-funded accounts)
      const genesisMints: [GenesisMint] = [
        {
          amount: 10_000_000n,
          type: shieldedTokenType,
          recipient: senderKeys,
        },
      ];
      const simulator = yield* Simulator.init({ mode: 'genesis', genesisMints });

      // Step 2: Create wallet factory with simulator-based capabilities
      // All capabilities use the same simulator instance for consistent state
      const Wallet = CustomShieldedWallet(
        {
          simulator,
          networkId: NetworkId.NetworkId.Undeployed,
        },
        new V1Builder()
          .withTransactionType<ledger.ProofErasedTransaction>()
          .withCoinSelectionDefaults()
          .withTransacting(Transacting.makeSimulatorTransactingCapability)
          .withTransactionHistory(TransactionHistory.makeSimulatorTransactionHistoryCapability)
          .withSync(Sync.makeSimulatorSyncService, Sync.makeSimulatorSyncCapability)
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withSerializationDefaults(),
      );

      // Step 3: Create simulator services for proving and submission
      // These bypass real ZK proving and network submission
      const provingService = makeSimulatorProvingServiceEffect();
      const submissionService = Submission.makeSimulatorSubmissionService<ledger.ProofErasedTransaction>('InBlock')({
        simulator,
      });

      // Step 4: Instantiate wallets for sender and receiver
      const senderWallet = Wallet.startWithSecretKeys(senderKeys);
      const receiverWallet = Wallet.startWithSecretKeys(receiverKeys);

      yield* Effect.promise(() => senderWallet.start(senderKeys));
      yield* Effect.promise(() => receiverWallet.start(receiverKeys));

      // Step 5: Wait for sender wallet to sync and see the genesis funds
      yield* Effect.promise(() => {
        return pipe(
          senderWallet.state,
          rx.filter((s) => s.availableCoins.length > 0),
          rx.firstValueFrom,
        );
      });

      // Step 6: Create, prove, and submit a transfer transaction
      // In simulation mode, proving is instant (no ZK computation)
      yield* Effect.promise(async () => {
        return await senderWallet.transferTransaction(senderKeys, [
          {
            type: shieldedTokenType,
            amount: 42n,
            receiverAddress: await receiverWallet.getAddress(),
          },
        ]);
      }).pipe(
        Effect.flatMap((unprovenTx) => provingService.prove(unprovenTx)),
        Effect.flatMap((tx) => submissionService.submitTransaction(tx, 'InBlock')),
        Effect.forkScoped,
      );

      // Step 7: Wait for receiver wallet to see the transferred funds
      const finalBalance = yield* Effect.promise(() =>
        pipe(
          receiverWallet.state,
          rx.filter((state) => state.availableCoins.length > 0),
          rx.map((state) => state.balances[shieldedTokenType] ?? 0n),
          (a) => rx.firstValueFrom(a),
        ),
      );

      expect(finalBalance).toEqual(42n);
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
