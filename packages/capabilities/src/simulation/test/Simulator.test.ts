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
import { Chunk, Effect, Fiber, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { Simulator } from '../Simulator.js';

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
        expect(state.lastTxNumber).toBe(0n);
        expect(state.lastTxResult).toBeDefined();
        expect(state.lastTxResult?.events.length).toBeGreaterThan(0);
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
        expect(state.lastTxResult).toBeDefined();
        expect(state.lastTxResult?.events.length).toBeGreaterThan(0);
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
          expect(stateOption.value.lastTxResult).toBeDefined();
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

        // Blank mode should have no transactions yet
        expect(state.lastTxNumber).toBe(0n);
        expect(state.lastTx).toBeUndefined();
        expect(state.lastTxResult).toBeUndefined();
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
    it('advances the block number', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const initialState = yield* simulator.getLatestState();
        expect(initialState.lastTxNumber).toBe(0n);

        yield* simulator.fastForward(100n);

        const advancedState = yield* simulator.getLatestState();
        expect(advancedState.lastTxNumber).toBe(100n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('clears lastTx and lastTxResult when fast-forwarding', async () => {
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

        // Genesis mode has a lastTxResult
        const initialState = yield* simulator.getLatestState();
        expect(initialState.lastTxResult).toBeDefined();

        yield* simulator.fastForward(100n);

        const advancedState = yield* simulator.getLatestState();
        expect(advancedState.lastTx).toBeUndefined();
        expect(advancedState.lastTxResult).toBeUndefined();
        expect(advancedState.lastTxNumber).toBe(100n);
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

    it('creates block context from block number', async () => {
      const blockNumber = 42n;
      const context = await Effect.runPromise(Simulator.nextBlockContextFromNumber(blockNumber));

      expect(context.secondsSinceEpoch).toBe(blockNumber);
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

        const blockContext = yield* Simulator.nextBlockContextFromNumber(state.lastTxNumber + 1n);

        const result = Simulator.apply(state, tx, strictness, blockContext);

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

        const blockContext = yield* Simulator.nextBlockContextFromNumber(state.lastTxNumber + 1n);

        const result = Simulator.apply(state, tx, strictness, blockContext);

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
        expect(initialState.lastTxNumber).toBe(0n);

        // Create a simple transaction
        const coin = ledger.createShieldedCoinInfo(shieldedTokenType, 100n);
        const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
        const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, 100n);
        const tx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();

        // Submit the transaction
        const blockInfo = yield* simulator.submitTransaction(tx);

        // Verify block info
        expect(blockInfo.blockNumber).toBeGreaterThan(0n);
        expect(blockInfo.blockHash).toMatch(/^[0-9a-f]{64}$/);

        // Verify state was updated
        const newState = yield* simulator.getLatestState();
        expect(newState.lastTxNumber).toBeGreaterThan(initialState.lastTxNumber);
        expect(newState.lastTx).toBeDefined();
        expect(newState.lastTxResult).toBeDefined();
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
        const blockInfo = yield* simulator.submitTransaction(tx, {
          strictness: { enforceBalancing: false },
        });

        expect(blockInfo.blockNumber).toBeGreaterThan(0n);
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

        // Get latest state from stream and verify it reflects the submission
        const latestFromStream = yield* simulator.state$.pipe(Stream.take(1), Stream.runCollect);
        const states = Chunk.toArray(latestFromStream);

        expect(states.length).toBe(1);
        expect(states[0]?.lastTxNumber).toBeGreaterThan(0n);
        expect(states[0]?.lastTx).toBeDefined();
        expect(states[0]?.lastTxResult).toBeDefined();
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('rewardNight', () => {
    it('distributes Night tokens and updates simulator state', async () => {
      // Note: Full success testing is done in dust-wallet tests which have
      // complete wallet infrastructure. This test verifies basic mechanics.
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          mode: 'blank',
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const initialState = yield* simulator.getLatestState();
        expect(initialState.lastTxNumber).toBe(0n);

        // Create Ed25519 signing key for Night tokens (different from ZswapSecretKeys)
        const secretKeyHex = Buffer.alloc(32, 1).toString('hex');
        const verifyingKey = ledger.signatureVerifyingKey(secretKeyHex);
        const userAddress = ledger.addressFromKey(verifyingKey);

        // Reward Night tokens
        const blockInfo = yield* simulator.rewardNight(userAddress, 1000n, verifyingKey);

        // Verify block info was returned
        expect(blockInfo.blockNumber).toBeGreaterThan(0n);
        expect(blockInfo.blockHash).toMatch(/^[0-9a-f]{64}$/);

        // Verify state was updated with a transaction result
        const newState = yield* simulator.getLatestState();
        expect(newState.lastTxResult).toBeDefined();
        expect(newState.lastTxNumber).toBe(blockInfo.blockNumber);
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

        // Submit multiple transactions
        const blockInfo1 = yield* simulator.submitTransaction(tx);
        const blockInfo2 = yield* simulator.submitTransaction(tx);
        const blockInfo3 = yield* simulator.submitTransaction(tx);

        // Each transaction should have incrementing block numbers
        expect(blockInfo2.blockNumber).toBeGreaterThan(blockInfo1.blockNumber);
        expect(blockInfo3.blockNumber).toBeGreaterThan(blockInfo2.blockNumber);

        const finalState = yield* simulator.getLatestState();
        expect(finalState.lastTxNumber).toBe(blockInfo3.blockNumber);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });
});
