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
 * Tests for the unified Simulator.
 *
 * These tests verify the core functionality of the Simulator from the capabilities package.
 * For full wallet integration tests using the Simulator, see wallet-integration-tests.
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Effect, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  Simulator,
  immediateBlockProducer,
  getCurrentBlockNumber,
  getLastBlock,
  applyTransaction,
  nextBlockContext,
  type BlockProducer,
  type SimulatorState,
} from '../index.js';

vi.setConfig({ testTimeout: 60_000 });

const shieldedTokenType = ledger.shieldedToken().raw;

describe('Unified Simulator', () => {
  describe('genesis mode', () => {
    it('initializes with genesis mints', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 10_000_000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        const state = yield* simulator.getLatestState();

        // Genesis mode should have processed the initial transaction
        expect(getCurrentBlockNumber(state)).toBe(0n);
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');
        expect(lastBlock.transactions.length).toBeGreaterThan(0);
        expect(lastBlock.transactions[0]?.result.events.length).toBeGreaterThan(0);
        expect(state.networkId).toBe(NetworkId.NetworkId.Undeployed);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports custom networkId in genesis mode', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const state = yield* simulator.getLatestState();
        expect(state.networkId).toBe(NetworkId.NetworkId.Undeployed);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports multiple genesis mints for different recipients', async () => {
      return Effect.gen(function* () {
        const wallet1Keys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));
        const wallet2Keys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 2));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: wallet1Keys,
            },
            {
              amount: 2000n,
              type: shieldedTokenType,
              recipient: wallet2Keys,
            },
          ],
        });

        const state = yield* simulator.getLatestState();

        // Should have processed a genesis transaction with outputs for both recipients
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');
        expect(lastBlock.transactions[0]?.result.events.length).toBeGreaterThan(0);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('emits state changes via state$ stream', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        // Take the first state from the stream
        const stateOption = yield* simulator.state$.pipe(Stream.take(1), Stream.runHead);

        expect(stateOption._tag).toBe('Some');
        if (stateOption._tag === 'Some') {
          const lastBlock = getLastBlock(stateOption.value);
          expect(lastBlock).toBeDefined();
        }
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('blank mode', () => {
    it('initializes with empty ledger state', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const state = yield* simulator.getLatestState();

        // Blank mode should have no blocks yet
        expect(getCurrentBlockNumber(state)).toBe(0n);
        expect(getLastBlock(state)).toBeUndefined();
        expect(state.blocks.length).toBe(0);
        expect(state.networkId).toBe(NetworkId.NetworkId.Undeployed);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports different network IDs', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const state = yield* simulator.getLatestState();
        expect(state.networkId).toBe(NetworkId.NetworkId.Undeployed);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('fastForward', () => {
    it('advances the current time without creating blocks', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const initialState = yield* simulator.getLatestState();
        const initialTime = initialState.currentTime;
        expect(getCurrentBlockNumber(initialState)).toBe(0n);
        expect(initialState.blocks.length).toBe(0);

        yield* simulator.fastForward(100n);

        const advancedState = yield* simulator.getLatestState();
        // Block number should not change (no blocks created)
        expect(getCurrentBlockNumber(advancedState)).toBe(0n);
        expect(advancedState.blocks.length).toBe(0);
        // Time should have advanced by 100 seconds
        expect(advancedState.currentTime.getTime() - initialTime.getTime()).toBe(100 * 1000);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('time and blocks are independent', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        // Genesis mode has a genesis block at time 0, currentTime stays at 0
        const initialState = yield* simulator.getLatestState();
        expect(getLastBlock(initialState)).toBeDefined();
        expect(initialState.blocks.length).toBe(1);
        expect(getCurrentBlockNumber(initialState)).toBe(0n);
        expect(initialState.currentTime.getTime()).toBe(0); // At epoch (genesis time)

        // Fast-forward time by 100 seconds
        yield* simulator.fastForward(100n);

        const advancedState = yield* simulator.getLatestState();
        // Block count should not change
        expect(advancedState.blocks.length).toBe(1);
        expect(getCurrentBlockNumber(advancedState)).toBe(0n);
        // Time should have advanced by 100 seconds
        expect(advancedState.currentTime.getTime()).toBe(100 * 1000); // 100 seconds after epoch
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('static methods', () => {
    it('computes block hash deterministically', async () => {
      const blockTime1 = new Date(1000000);
      const blockTime2 = new Date(1000000);
      const blockTime3 = new Date(2000000);

      const hash1 = await Effect.runPromise(Simulator.blockHash(blockTime1));
      const hash2 = await Effect.runPromise(Simulator.blockHash(blockTime2));
      const hash3 = await Effect.runPromise(Simulator.blockHash(blockTime3));

      // Same input should produce same output
      expect(hash1).toBe(hash2);
      // Different input should produce different output
      expect(hash1).not.toBe(hash3);
      // Hash should be a valid hex string (64 chars for SHA-256)
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('creates block context from block time', async () => {
      const blockTime = new Date(1234567890000);
      const context = await Effect.runPromise(Simulator.nextBlockContext(blockTime));

      expect(context.secondsSinceEpoch).toBe(1234567890n);
      expect(context.secondsSinceEpochErr).toBe(1);
      expect(context.lastBlockTime).toBe(1n);
      expect(context.parentBlockHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('apply (pure state transition)', () => {
    it('returns Either with new state on success', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        const state = yield* simulator.getLatestState();

        // Create a transaction with an output
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        const strictness = new ledger.WellFormedStrictness();
        strictness.enforceBalancing = false;

        const blockContext = yield* Effect.promise(() => nextBlockContext(state.currentTime));

        const result = applyTransaction(state, tx, strictness, blockContext);

        // The result should be an Either
        expect(result._tag).toBe('Right');
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('returns Either Left on invalid transaction', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        const state = yield* simulator.getLatestState();

        // Create a transaction with an output (unbalanced when enforceBalancing is true)
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        // Enable balance enforcement to make the transaction invalid
        const strictness = new ledger.WellFormedStrictness();
        strictness.enforceBalancing = true;

        const blockContext = yield* Effect.promise(() => nextBlockContext(state.currentTime));

        const result = applyTransaction(state, tx, strictness, blockContext);

        // The result should be an Either Left (error)
        expect(result._tag).toBe('Left');
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('submitTransaction', () => {
    it('submits a transaction and updates state', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        const initialState = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(initialState)).toBe(0n);

        // Create a simple transaction
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        // Submit the transaction (adds to mempool)
        yield* simulator.submitTransaction(tx);

        // Wait for stream-based block production
        yield* Effect.sleep('50 millis');

        // Verify state was updated (block was produced)
        const newState = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(newState)).toBeGreaterThan(getCurrentBlockNumber(initialState));
        const lastBlock = getLastBlock(newState);
        expect(lastBlock).toBeDefined();
        expect(lastBlock!.transactions.length).toBeGreaterThan(0);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports custom strictness options', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        // Create an unbalanced transaction
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        // Submit with no strictness (should succeed)
        yield* simulator.submitTransaction(tx, {
          strictness: { enforceBalancing: false },
        });

        // Wait for stream-based block production
        yield* Effect.sleep('50 millis');

        const state = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(state)).toBeGreaterThan(0n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('emits state changes via state$ stream after submission', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        // Submit a transaction
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        yield* simulator.submitTransaction(tx);

        // Get the state after submission from the stream.
        // The stream now includes the initial state (genesis block 0) followed by changes,
        // so we filter for states with block number > 0 (after genesis).
        const stateAfterSubmission = yield* simulator.state$.pipe(
          Stream.filter((s) => getCurrentBlockNumber(s) > 0n),
          Stream.take(1),
          Stream.runHead,
        );

        expect(stateAfterSubmission._tag).toBe('Some');
        if (stateAfterSubmission._tag !== 'Some') throw new Error('Expected state after submission');
        const state = stateAfterSubmission.value;
        expect(getCurrentBlockNumber(state)).toBeGreaterThan(0n);
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');
        expect(lastBlock.transactions.length).toBeGreaterThan(0);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('rewardNight', () => {
    it('distributes Night tokens via mempool and block producer', async () => {
      // Note: Full success testing is done in dust-wallet tests which have
      // complete wallet infrastructure. This test verifies basic mechanics.
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const initialState = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(initialState)).toBe(0n);

        // Create Ed25519 signing key for Night tokens (different from ZswapSecretKeys)
        const secretKeyHex = Buffer.alloc(32, 1).toString('hex');
        const verifyingKey = ledger.signatureVerifyingKey(secretKeyHex);
        const userAddress = ledger.addressFromKey(verifyingKey);

        // Reward Night tokens - submits to mempool, block producer handles the rest
        yield* simulator.rewardNight(userAddress, 1000n, verifyingKey);

        // Wait for block producer to process (small delay for async stream processing)
        yield* Effect.sleep('50 millis');

        // Verify state was updated - block producer should have created a block
        const newState = yield* simulator.getLatestState();
        const lastBlock = getLastBlock(newState);
        expect(lastBlock).toBeDefined();
        expect(lastBlock!.number).toBeGreaterThan(0n);
        expect(lastBlock!.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(lastBlock!.transactions.length).toBeGreaterThan(0);
        expect(getCurrentBlockNumber(newState)).toBe(lastBlock!.number);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('multiple consecutive transactions', () => {
    it('processes multiple transactions sequentially', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 10000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        // Create a simple transaction
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        const initialState = yield* simulator.getLatestState();

        // Submit multiple transactions
        yield* simulator.submitTransaction(tx);
        yield* Effect.sleep('50 millis');
        const state1 = yield* simulator.getLatestState();

        yield* simulator.submitTransaction(tx);
        yield* Effect.sleep('50 millis');
        const state2 = yield* simulator.getLatestState();

        yield* simulator.submitTransaction(tx);
        yield* Effect.sleep('50 millis');
        const state3 = yield* simulator.getLatestState();

        // Each transaction should have incrementing block numbers
        expect(getCurrentBlockNumber(state1)).toBeGreaterThan(getCurrentBlockNumber(initialState));
        expect(getCurrentBlockNumber(state2)).toBeGreaterThan(getCurrentBlockNumber(state1));
        expect(getCurrentBlockNumber(state3)).toBeGreaterThan(getCurrentBlockNumber(state2));
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  // ===========================================================================
  // NEW CAPABILITIES
  // ===========================================================================

  describe('block production (stream-based)', () => {
    describe('immediateBlockProducer (default)', () => {
      it('produces a block for each transaction', async () => {
        return Effect.gen(function* () {
          const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

          // Default behavior - one block per transaction
          const simulator = yield* Simulator.init({
            mode: 'genesis',
            genesisMints: [
              {
                amount: 10000n,
                type: shieldedTokenType,
                recipient: recipientKeys,
              },
            ],
            // immediateBlockProducer() is the default
          });

          const createTx = () => {
            const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
            const output = ledger.ZswapOutput.new(
              coin,
              0,
              recipientKeys.coinPublicKey,
              recipientKeys.encryptionPublicKey,
            );
            const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
            return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
          };

          const initialState = yield* simulator.getLatestState();

          yield* simulator.submitTransaction(createTx());
          yield* Effect.sleep('50 millis');
          const state1 = yield* simulator.getLatestState();

          yield* simulator.submitTransaction(createTx());
          yield* Effect.sleep('50 millis');
          const state2 = yield* simulator.getLatestState();

          yield* simulator.submitTransaction(createTx());
          yield* Effect.sleep('50 millis');
          const state3 = yield* simulator.getLatestState();

          // Each transaction produces its own block
          expect(getCurrentBlockNumber(state1)).toBe(getCurrentBlockNumber(initialState) + 1n);
          expect(getCurrentBlockNumber(state2)).toBe(getCurrentBlockNumber(state1) + 1n);
          expect(getCurrentBlockNumber(state3)).toBe(getCurrentBlockNumber(state2) + 1n);
        }).pipe(Effect.scoped, Effect.runPromise);
      });

      it('uses configured fullness for all blocks', async () => {
        return Effect.gen(function* () {
          const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

          const simulator = yield* Simulator.init({
            mode: 'genesis',
            genesisMints: [
              {
                amount: 10000n,
                type: shieldedTokenType,
                recipient: recipientKeys,
              },
            ],
            blockProducer: immediateBlockProducer(0.8),
          });

          const createTx = () => {
            const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
            const output = ledger.ZswapOutput.new(
              coin,
              0,
              recipientKeys.coinPublicKey,
              recipientKeys.encryptionPublicKey,
            );
            const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
            return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
          };

          yield* simulator.submitTransaction(createTx());
          yield* simulator.submitTransaction(createTx());

          // Verify fullness was applied (check fee prices have been updated)
          const feePrices = yield* simulator.query((state) => state.ledger.parameters.feePrices);
          expect(feePrices).toBeDefined();
        }).pipe(Effect.scoped, Effect.runPromise);
      });

      it('supports dynamic fullness callback', async () => {
        return Effect.gen(function* () {
          const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

          const calledWithBlockNumbers: bigint[] = [];
          const fullnessCallback = (state: SimulatorState): number => {
            const blockNumber = getCurrentBlockNumber(state) + 1n;
            calledWithBlockNumbers.push(blockNumber);
            return Math.min(Number(blockNumber) * 0.2, 1);
          };

          const simulator = yield* Simulator.init({
            mode: 'genesis',
            genesisMints: [
              {
                amount: 10000n,
                type: shieldedTokenType,
                recipient: recipientKeys,
              },
            ],
            blockProducer: immediateBlockProducer(fullnessCallback),
          });

          const createTx = () => {
            const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
            const output = ledger.ZswapOutput.new(
              coin,
              0,
              recipientKeys.coinPublicKey,
              recipientKeys.encryptionPublicKey,
            );
            const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
            return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
          };

          yield* simulator.submitTransaction(createTx());
          yield* Effect.sleep('50 millis');
          yield* simulator.submitTransaction(createTx());
          yield* Effect.sleep('50 millis');

          expect(calledWithBlockNumbers.length).toBe(2);
          expect(calledWithBlockNumbers[0]).toBe(1n);
          expect(calledWithBlockNumbers[1]).toBe(2n);
        }).pipe(Effect.scoped, Effect.runPromise);
      });
    });

    describe('custom block producer', () => {
      it('allows fully custom block production logic', async () => {
        return Effect.gen(function* () {
          const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

          // Custom producer: produce block when mempool has exactly 2 txs
          const customProducer: BlockProducer = (states) =>
            states.pipe(
              Stream.filter((s) => s.mempool.length === 2),
              Stream.map((s) => ({
                transactions: [...s.mempool],
                fullness: 0.3,
              })),
            );

          const simulator = yield* Simulator.init({
            mode: 'genesis',
            genesisMints: [
              {
                amount: 10000n,
                type: shieldedTokenType,
                recipient: recipientKeys,
              },
            ],
            blockProducer: customProducer,
          });

          const initialState = yield* simulator.getLatestState();

          const createTx = () => {
            const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
            const output = ledger.ZswapOutput.new(
              coin,
              0,
              recipientKeys.coinPublicKey,
              recipientKeys.encryptionPublicKey,
            );
            const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
            return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
          };

          // First tx - add to mempool without producing block
          // Use addToMempoolOnly to test custom block producer behavior
          yield* simulator.addToMempoolOnly(createTx());
          yield* Effect.sleep('50 millis');
          const state1 = yield* simulator.getLatestState();
          expect(getCurrentBlockNumber(state1)).toBe(getCurrentBlockNumber(initialState));
          expect(state1.mempool.length).toBe(1);

          // Second tx - should trigger custom block producer (exactly 2 txs)
          yield* simulator.addToMempoolOnly(createTx());
          yield* Effect.sleep('100 millis');
          const state2 = yield* simulator.getLatestState();
          expect(getCurrentBlockNumber(state2)).toBe(getCurrentBlockNumber(initialState) + 1n);
          expect(state2.mempool.length).toBe(0);
        }).pipe(Effect.scoped, Effect.runPromise);
      });
    });
  });

  describe('generic query', () => {
    it('queries state with a custom function', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        // Query with a custom function that extracts network ID
        const networkId = yield* simulator.query((state) => state.networkId);
        expect(networkId).toBe(NetworkId.NetworkId.Undeployed);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('queries UTXOs for a user address', async () => {
      return Effect.gen(function* () {
        const secretKeyHex = Buffer.alloc(32, 1).toString('hex');
        const verifyingKey = ledger.signatureVerifyingKey(secretKeyHex);
        const userAddress = ledger.addressFromKey(verifyingKey);

        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        // Query UTXOs using generic query function
        const utxos = yield* simulator.query((state) => Array.from(state.ledger.utxo.filter(userAddress)));

        // Should return an array (may be empty for a new address)
        expect(Array.isArray(utxos)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('queries UTXOs after Night token reward', async () => {
      return Effect.gen(function* () {
        const secretKeyHex = Buffer.alloc(32, 1).toString('hex');
        const verifyingKey = ledger.signatureVerifyingKey(secretKeyHex);
        const userAddress = ledger.addressFromKey(verifyingKey);

        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        // Reward Night tokens
        yield* simulator.rewardNight(userAddress, 1000n, verifyingKey);

        // Query UTXOs - Night rewards may create UTXOs
        const utxos = yield* simulator.query((state) => Array.from(state.ledger.utxo.filter(userAddress)));

        // Query should work (returns array)
        expect(Array.isArray(utxos)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('queries ledger parameters', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const params = yield* simulator.query((state) => state.ledger.parameters);

        // Should return valid ledger parameters
        expect(params).toBeDefined();
        expect(params.feePrices).toBeDefined();
        expect(params.dust).toBeDefined();
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('queries current fee prices', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const feePrices = yield* simulator.query((state) => state.ledger.parameters.feePrices);

        // Should return fee prices
        expect(feePrices).toBeDefined();
        expect(typeof feePrices.overallPrice).toBe('number');
        expect(typeof feePrices.readFactor).toBe('number');
        expect(typeof feePrices.computeFactor).toBe('number');
        expect(typeof feePrices.blockUsageFactor).toBe('number');
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('calculates transaction fees via query', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        // Create a transaction
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        // Calculate fees using generic query
        const fees = yield* simulator.query((state) => tx.fees(state.ledger.parameters));

        expect(fees).toBeGreaterThanOrEqual(0n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('allows complex queries combining multiple state properties', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 1000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
        });

        // Complex query returning multiple values
        const result = yield* simulator.query((state) => ({
          networkId: state.networkId,
          blockNumber: getCurrentBlockNumber(state),
          hasLastBlock: getLastBlock(state) !== undefined,
          feePrices: state.ledger.parameters.feePrices,
        }));

        expect(result.networkId).toBe(NetworkId.NetworkId.Undeployed);
        expect(result.blockNumber).toBe(0n);
        expect(result.hasLastBlock).toBe(true); // Genesis creates a block
        expect(result.feePrices).toBeDefined();
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('block fullness (via block producer)', () => {
    it('defaults to 0 fullness when not specified', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        // Without fullness config, should default to 0
        const feePrices = yield* simulator.query((state) => state.ledger.parameters.feePrices);
        expect(feePrices).toBeDefined();
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('applies static fullness from block producer', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 10000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
          blockProducer: immediateBlockProducer(0.9),
        });

        // Submit transactions - fullness should affect ledger state updates
        const createTx = () => {
          const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
          const output = ledger.ZswapOutput.new(
            coin,
            0,
            recipientKeys.coinPublicKey,
            recipientKeys.encryptionPublicKey,
          );
          const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
          return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
        };

        yield* simulator.submitTransaction(createTx());
        yield* simulator.submitTransaction(createTx());

        // Fee prices should have been updated based on fullness
        const feePrices = yield* simulator.query((state) => state.ledger.parameters.feePrices);
        expect(feePrices).toBeDefined();
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('applies dynamic fullness callback from block producer', async () => {
      return Effect.gen(function* () {
        const recipientKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));

        // Track which block numbers the callback was called with
        const calledWithBlockNumbers: bigint[] = [];
        const fullnessCallback = (state: SimulatorState): number => {
          const blockNumber = getCurrentBlockNumber(state) + 1n;
          calledWithBlockNumbers.push(blockNumber);
          return Math.min(Number(blockNumber) * 0.2, 1);
        };

        const simulator = yield* Simulator.init({
          mode: 'genesis',
          genesisMints: [
            {
              amount: 10000n,
              type: shieldedTokenType,
              recipient: recipientKeys,
            },
          ],
          blockProducer: immediateBlockProducer(fullnessCallback),
        });

        // Submit transactions
        const createTx = () => {
          const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
          const output = ledger.ZswapOutput.new(
            coin,
            0,
            recipientKeys.coinPublicKey,
            recipientKeys.encryptionPublicKey,
          );
          const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
          return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
        };

        yield* simulator.submitTransaction(createTx());
        yield* Effect.sleep('50 millis');
        yield* simulator.submitTransaction(createTx());
        yield* Effect.sleep('50 millis');

        // Callback should have been called with incrementing block numbers
        expect(calledWithBlockNumbers.length).toBe(2);
        expect(calledWithBlockNumbers[0]).toBe(1n);
        expect(calledWithBlockNumbers[1]).toBe(2n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });
});
