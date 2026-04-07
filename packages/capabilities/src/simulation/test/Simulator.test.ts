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
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Effect, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  Simulator,
  immediateBlockProducer,
  genesisStrictness,
  getCurrentBlockNumber,
  getLastBlock,
  applyTransaction,
  nextBlockContext,
  assignStrictnessToAll,
  createStrictness,
  type BlockProducer,
  type GenesisMint,
  type SimulatorState,
} from '../index.js';

vi.setConfig({ testTimeout: 60_000 });

const shieldedTokenType = ledger.shieldedToken().raw;

/** Create ZswapSecretKeys from a numeric seed index. */
const createKeys = (seed: number) => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, seed));

/** Create an unbalanced shielded transaction (no fees) for testing. */
const createUnbalancedTx = (recipientKeys: ledger.ZswapSecretKeys, amount = 100n) => {
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType, amount);
  const output = ledger.ZswapOutput.new(coin, 0, recipientKeys.coinPublicKey, recipientKeys.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, shieldedTokenType, amount);
  return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
};

/** Create Night-compatible signing keys from a numeric seed index. */
const createNightKeys = (seed: number) => {
  const secretKeyHex = Buffer.alloc(32, seed).toString('hex');
  const verifyingKey = ledger.signatureVerifyingKey(secretKeyHex);
  const userAddress = ledger.addressFromKey(verifyingKey);
  return { verifyingKey, userAddress };
};

/** Standard shielded genesis mint for a single recipient. */
const shieldedGenesisMint = (recipientKeys: ledger.ZswapSecretKeys, amount = 1000n): GenesisMint => ({
  type: 'shielded',
  tokenType: shieldedTokenType,
  amount,
  recipient: recipientKeys,
});

/** Verify a shielded recipient received coins by replaying events with their secret keys. */
const verifyShieldedReceipt = (
  recipientKeys: ledger.ZswapSecretKeys,
  events: readonly ledger.Event[],
  tokenType: string,
  expectedAmount: bigint,
) => {
  const walletState = new ledger.ZswapLocalState().replayEvents(recipientKeys, [...events]);
  const coins = Array.from(walletState.coins);
  const coin = coins.find((c) => c.type === tokenType);
  expect(coin).toBeDefined();
  expect(coin?.value).toBe(expectedAmount);
};

describe('Unified Simulator', () => {
  describe('with genesis mints', () => {
    it('initializes with genesis mints', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys, 10_000_000n)],
        });

        const state = yield* simulator.getLatestState();

        // Should have processed the initial transaction
        expect(getCurrentBlockNumber(state)).toBe(0n);
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');
        expect(lastBlock.transactions.length).toBeGreaterThan(0);
        expect(state.networkId).toBe(NetworkId.NetworkId.Undeployed);

        // Verify recipient received the shielded tokens by replaying events
        const events = lastBlock.transactions.flatMap((tx) => tx.result.events);
        verifyShieldedReceipt(recipientKeys, events, shieldedTokenType, 10_000_000n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports custom networkId with genesis mints', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        // Use a custom network ID (any string is valid, not just well-known ones)
        const customNetworkId = `custom-test-network-${Date.now()}`;

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
          networkId: customNetworkId,
        });

        const state = yield* simulator.getLatestState();
        expect(state.networkId).toBe(customNetworkId);

        // Verify recipient received the shielded tokens
        const events = getLastBlock(state)!.transactions.flatMap((tx) => tx.result.events);
        verifyShieldedReceipt(recipientKeys, events, shieldedTokenType, 1000n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports multiple genesis mints for different recipients', async () => {
      return Effect.gen(function* () {
        const wallet1Keys = createKeys(1);
        const wallet2Keys = createKeys(2);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(wallet1Keys), shieldedGenesisMint(wallet2Keys, 2000n)],
        });

        const state = yield* simulator.getLatestState();
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');

        // Verify both recipients received their shielded tokens
        const getEvents = () => lastBlock.transactions.flatMap((tx) => tx.result.events);
        verifyShieldedReceipt(wallet1Keys, getEvents(), shieldedTokenType, 1000n);
        verifyShieldedReceipt(wallet2Keys, getEvents(), shieldedTokenType, 2000n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('emits state changes via state$ stream', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
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

    it('supports unshielded genesis mints for custom tokens', async () => {
      // Note: Native Night tokens cannot be minted from nothing due to fixed supply invariant.
      // For Night tokens, use NightGenesisMint instead.
      return Effect.gen(function* () {
        const recipientAddress = ledger.sampleUserAddress();
        const customUnshieldedToken = ledger.sampleRawTokenType();

        const simulator = yield* Simulator.init({
          genesisMints: [
            {
              type: 'unshielded',
              tokenType: customUnshieldedToken,
              amount: 1000n,
              recipient: recipientAddress,
            },
          ],
        });

        const state = yield* simulator.getLatestState();

        expect(getCurrentBlockNumber(state)).toBe(0n);
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');

        // Transaction should be successful
        const txResult = lastBlock.transactions[0]?.result;
        expect(txResult?.type).toBe('success');

        // Verify recipient received the unshielded tokens
        const utxos = Array.from(state.ledger.utxo.filter(recipientAddress));
        const tokenUtxo = utxos.find((utxo) => utxo.type === customUnshieldedToken);
        expect(tokenUtxo).toBeDefined();
        expect(tokenUtxo?.value).toBe(1000n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports Night genesis mints', async () => {
      return Effect.gen(function* () {
        const nightAmount = 1_000_000n;
        const { verifyingKey, userAddress: recipientAddress } = createNightKeys(42);

        const simulator = yield* Simulator.init({
          genesisMints: [
            {
              type: 'unshielded',
              tokenType: ledger.nativeToken().raw, // Night is auto-detected by tokenType
              amount: nightAmount,
              recipient: recipientAddress,
              verifyingKey,
            },
          ],
        });

        const state = yield* simulator.getLatestState();

        expect(getCurrentBlockNumber(state)).toBe(0n);
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');

        // Should have a claim rewards transaction
        expect(lastBlock.transactions.length).toBe(1);
        const txResult = lastBlock.transactions[0]?.result;
        expect(txResult?.type).toBe('success');

        // Verify Night UTXOs are available for recipient with expected value
        const nightTokenType = ledger.nativeToken().raw;
        const utxos = Array.from(state.ledger.utxo.filter(recipientAddress));
        const nightUtxo = utxos.find((utxo) => utxo.type === nightTokenType);
        expect(nightUtxo).toBeDefined();
        expect(nightUtxo?.value).toBe(nightAmount);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports mixed genesis mints (shielded, unshielded, and Night)', async () => {
      return Effect.gen(function* () {
        const shieldedRecipient = createKeys(1);
        const unshieldedRecipient = ledger.sampleUserAddress();
        const customToken = ledger.sampleRawTokenType();
        const { verifyingKey: nightVerifyingKey, userAddress: nightRecipient } = createNightKeys(99);
        const nightTokenType = ledger.nativeToken().raw;

        const simulator = yield* Simulator.init({
          genesisMints: [
            {
              type: 'shielded',
              tokenType: shieldedTokenType,
              amount: 1000n,
              recipient: shieldedRecipient,
            },
            {
              type: 'unshielded',
              tokenType: customToken,
              amount: 2000n,
              recipient: unshieldedRecipient,
            },
            {
              type: 'unshielded',
              tokenType: nightTokenType, // Night is auto-detected by tokenType
              // Night claims have a minimum amount (around 14077), so use a larger value
              amount: 100_000n,
              recipient: nightRecipient,
              verifyingKey: nightVerifyingKey,
            },
          ],
        });

        const state = yield* simulator.getLatestState();

        expect(getCurrentBlockNumber(state)).toBe(0n);
        const lastBlock = getLastBlock(state);
        expect(lastBlock).toBeDefined();
        if (lastBlock === undefined) throw new Error('lastBlock should be defined');

        // Should have 2 transactions: one for shielded+unshielded, one for Night claim
        expect(lastBlock.transactions.length).toBe(2);

        // All transactions should be successful
        const [firstTx, secondTx] = lastBlock.transactions;
        expect(firstTx?.result.type).toBe('success');
        expect(secondTx?.result.type).toBe('success');

        // Verify recipients can receive the tokens by checking ledger state

        // Shielded: verify recipient can decrypt and receive the minted coins
        const events = lastBlock.transactions.flatMap((tx) => tx.result.events);
        verifyShieldedReceipt(shieldedRecipient, events, shieldedTokenType, 1000n);

        // Unshielded custom token: verify UTXO exists for recipient
        const unshieldedUtxos = Array.from(state.ledger.utxo.filter(unshieldedRecipient));
        const customTokenUtxo = unshieldedUtxos.find((utxo) => utxo.type === customToken);
        expect(customTokenUtxo).toBeDefined();
        expect(customTokenUtxo?.value).toBe(2000n);

        // Night: verify UTXO exists for recipient
        const nightUtxos = Array.from(state.ledger.utxo.filter(nightRecipient));
        const nightUtxo = nightUtxos.find((utxo) => utxo.type === nightTokenType);
        expect(nightUtxo).toBeDefined();
        expect(nightUtxo?.value).toBe(100_000n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });

  describe('without genesis mints', () => {
    it('initializes with empty ledger state', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const state = yield* simulator.getLatestState();

        // Should have no blocks yet
        expect(getCurrentBlockNumber(state)).toBe(0n);
        expect(getLastBlock(state)).toBeUndefined();
        expect(state.blocks.length).toBe(0);
        expect(state.networkId).toBe(NetworkId.NetworkId.Undeployed);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports different network IDs', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
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
        const recipientKeys = createKeys(0);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
        });

        // With genesis mints, a genesis block is created at time 0
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
      // Without previous block time, defaults to assuming 1 second since last block
      expect(context.lastBlockTime).toBe(1n);
      expect(context.parentBlockHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('creates block context with correct lastBlockTime when previous block time is provided', async () => {
      const previousBlockTime = new Date(1234567880000); // 10 seconds before
      const blockTime = new Date(1234567890000);
      const context = await nextBlockContext(blockTime, previousBlockTime);

      expect(context.secondsSinceEpoch).toBe(1234567890n);
      expect(context.secondsSinceEpochErr).toBe(1);
      // Should calculate time since last block: 1234567890 - 1234567880 = 10 seconds
      expect(context.lastBlockTime).toBe(10n);
      expect(context.parentBlockHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('apply (pure state transition)', () => {
    it('returns Either with new state on success', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
        });

        const state = yield* simulator.getLatestState();

        // Create a transaction with an output
        const tx = createUnbalancedTx(recipientKeys);

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
        const recipientKeys = createKeys(0);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
        });

        const state = yield* simulator.getLatestState();

        // Create a transaction with an output (unbalanced when enforceBalancing is true)
        const tx = createUnbalancedTx(recipientKeys);

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
        const recipientKeys = createKeys(0);

        // Use genesisStrictness since test creates unbalanced transactions
        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
          blockProducer: immediateBlockProducer(undefined, genesisStrictness),
        });

        const initialState = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(initialState)).toBe(0n);

        // Create a simple transaction (unbalanced - no fees)
        const tx = createUnbalancedTx(recipientKeys);

        // Submit the transaction — submitTransaction waits for block inclusion
        yield* simulator.submitTransaction(tx);

        // Verify state was updated (block was produced)
        const newState = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(newState)).toBeGreaterThan(getCurrentBlockNumber(initialState));
        const lastBlock = getLastBlock(newState);
        expect(lastBlock).toBeDefined();
        expect(lastBlock!.transactions.length).toBeGreaterThan(0);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('supports custom strictness options on submitTransaction', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        // Use genesisStrictness block producer since test creates unbalanced transactions
        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
          blockProducer: immediateBlockProducer(),
        });

        // Create an unbalanced transaction
        const tx = createUnbalancedTx(recipientKeys);

        // Submit with custom strictness (currently ignored due to block producer precedence)
        yield* simulator.submitTransaction(tx, {
          strictness: { enforceBalancing: false },
        });

        const state = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(state)).toBeGreaterThan(0n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('emits state changes via state$ stream after submission', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        // Use genesisStrictness since test creates unbalanced transactions
        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
          blockProducer: immediateBlockProducer(undefined, genesisStrictness),
        });

        // Submit a transaction (unbalanced - no fees)
        const tx = createUnbalancedTx(recipientKeys);

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
          networkId: NetworkId.NetworkId.Undeployed,
        });

        const initialState = yield* simulator.getLatestState();
        expect(getCurrentBlockNumber(initialState)).toBe(0n);

        // Create signing key for Night tokens (different from ZswapSecretKeys)
        const { verifyingKey } = createNightKeys(1);

        // Reward Night tokens - submits to mempool, block producer handles the rest
        // rewardNight calls submitTransaction internally — waits for block inclusion
        yield* simulator.rewardNight(verifyingKey, 1000n);

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
        const recipientKeys = createKeys(0);

        // Use genesisStrictness since test creates unbalanced transactions
        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys, 10000n)],
          blockProducer: immediateBlockProducer(undefined, genesisStrictness),
        });

        // Create a simple transaction (unbalanced - no fees)
        const tx = createUnbalancedTx(recipientKeys);

        const initialState = yield* simulator.getLatestState();

        // Submit multiple transactions — each submitTransaction waits for block inclusion
        yield* simulator.submitTransaction(tx);
        const state1 = yield* simulator.getLatestState();

        yield* simulator.submitTransaction(tx);
        const state2 = yield* simulator.getLatestState();

        yield* simulator.submitTransaction(tx);
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
    describe('immediateBlockProducer with genesisStrictness', () => {
      it('produces a block for each transaction', async () => {
        return Effect.gen(function* () {
          const recipientKeys = createKeys(0);

          // Use genesisStrictness since test creates unbalanced transactions
          const simulator = yield* Simulator.init({
            genesisMints: [shieldedGenesisMint(recipientKeys, 10000n)],
            blockProducer: immediateBlockProducer(undefined, genesisStrictness),
          });

          const createTx = () => createUnbalancedTx(recipientKeys);

          const initialState = yield* simulator.getLatestState();

          yield* simulator.submitTransaction(createTx());
          const state1 = yield* simulator.getLatestState();

          yield* simulator.submitTransaction(createTx());
          const state2 = yield* simulator.getLatestState();

          yield* simulator.submitTransaction(createTx());
          const state3 = yield* simulator.getLatestState();

          // Each transaction produces its own block
          expect(getCurrentBlockNumber(state1)).toBe(getCurrentBlockNumber(initialState) + 1n);
          expect(getCurrentBlockNumber(state2)).toBe(getCurrentBlockNumber(state1) + 1n);
          expect(getCurrentBlockNumber(state3)).toBe(getCurrentBlockNumber(state2) + 1n);
        }).pipe(Effect.scoped, Effect.runPromise);
      });

      it('uses configured fullness for all blocks', async () => {
        return Effect.gen(function* () {
          const recipientKeys = createKeys(0);

          // Use genesisStrictness with custom fullness since test creates unbalanced transactions
          const simulator = yield* Simulator.init({
            genesisMints: [shieldedGenesisMint(recipientKeys, 10000n)],
            blockProducer: immediateBlockProducer(0.8, genesisStrictness),
          });

          const createTx = () => createUnbalancedTx(recipientKeys);

          yield* simulator.submitTransaction(createTx());
          yield* simulator.submitTransaction(createTx());

          // Verify fullness was applied (check fee prices have been updated)
          const feePrices = yield* simulator.query((state) => state.ledger.parameters.feePrices);
          expect(feePrices).toBeDefined();
        }).pipe(Effect.scoped, Effect.runPromise);
      });

      it('supports dynamic fullness callback', async () => {
        return Effect.gen(function* () {
          const recipientKeys = createKeys(0);

          const calledWithBlockNumbers: bigint[] = [];
          const fullnessCallback = (state: SimulatorState): number => {
            const blockNumber = getCurrentBlockNumber(state) + 1n;
            calledWithBlockNumbers.push(blockNumber);
            return Math.min(Number(blockNumber) * 0.2, 1);
          };

          // Use genesisStrictness with dynamic fullness since test creates unbalanced transactions
          const simulator = yield* Simulator.init({
            genesisMints: [shieldedGenesisMint(recipientKeys, 10000n)],
            blockProducer: immediateBlockProducer(fullnessCallback, genesisStrictness),
          });

          const createTx = () => createUnbalancedTx(recipientKeys);

          yield* simulator.submitTransaction(createTx());
          yield* simulator.submitTransaction(createTx());

          expect(calledWithBlockNumbers.length).toBe(2);
          expect(calledWithBlockNumbers[0]).toBe(1n);
          expect(calledWithBlockNumbers[1]).toBe(2n);
        }).pipe(Effect.scoped, Effect.runPromise);
      });
    });

    describe('custom block producer', () => {
      it('allows fully custom block production logic', async () => {
        return Effect.gen(function* () {
          const recipientKeys = createKeys(0);

          // Custom producer: produce block when mempool has exactly 2 txs
          // Must assign strictness to each transaction (use genesisStrictness for unbalanced txs)
          const defaultStrictness = createStrictness(genesisStrictness);
          const customProducer: BlockProducer = (states) =>
            states.pipe(
              Stream.filter((s) => s.mempool.length === 2),
              Stream.map((s) => ({
                transactions: assignStrictnessToAll(s.mempool, defaultStrictness),
                fullness: 0.3,
              })),
            );

          const simulator = yield* Simulator.init({
            genesisMints: [shieldedGenesisMint(recipientKeys, 10000n)],
            blockProducer: customProducer,
          });

          const initialState = yield* simulator.getLatestState();

          const createTx = () => createUnbalancedTx(recipientKeys);

          // First tx - add to mempool without producing block
          // Use submitAndForget to test custom block producer behavior
          yield* simulator.submitAndForget(createTx());
          const state1 = yield* simulator.getLatestState();
          expect(getCurrentBlockNumber(state1)).toBe(getCurrentBlockNumber(initialState));
          expect(state1.mempool.length).toBe(1);

          // Second tx - should trigger custom block producer (exactly 2 txs)
          yield* simulator.submitAndForget(createTx());
          // Wait for block production by watching the state stream
          const state2 = yield* simulator.state$.pipe(
            Stream.filter(
              (s) => s.mempool.length === 0 && getCurrentBlockNumber(s) > getCurrentBlockNumber(initialState),
            ),
            Stream.take(1),
            Stream.runHead,
          );
          expect(state2._tag).toBe('Some');
          if (state2._tag !== 'Some') throw new Error('Expected state after block production');
          expect(getCurrentBlockNumber(state2.value)).toBe(getCurrentBlockNumber(initialState) + 1n);
          expect(state2.value.mempool.length).toBe(0);
        }).pipe(Effect.scoped, Effect.runPromise);
      });
    });

    describe('strictness enforcement', () => {
      it('immediateBlockProducer enforces balancing by default (post-genesis strictness)', async () => {
        return Effect.gen(function* () {
          const recipientKeys = createKeys(0);

          // immediateBlockProducer defaults to post-genesis strictness: balancing=true, signatures=true, limits=true
          const simulator = yield* Simulator.init({
            genesisMints: [shieldedGenesisMint(recipientKeys, 10_000_000n)],
            // Default blockProducer (immediateBlockProducer with post-genesis strictness)
          });

          // The unbalanced transaction should fail because immediateBlockProducer enforces balancing
          const result = yield* Effect.either(simulator.submitTransaction(createUnbalancedTx(recipientKeys)));

          // Expect failure due to imbalance (transaction doesn't pay fees)
          expect(result._tag).toBe('Left');
        }).pipe(Effect.scoped, Effect.runPromise);
      });

      it('immediateBlockProducer with genesisStrictness allows unbalanced transactions', async () => {
        return Effect.gen(function* () {
          const recipientKeys = createKeys(0);

          // Use genesisStrictness to disable balancing enforcement
          const simulator = yield* Simulator.init({
            genesisMints: [shieldedGenesisMint(recipientKeys, 10_000_000n)],
            blockProducer: immediateBlockProducer(undefined, genesisStrictness),
          });

          // With genesisStrictness (balancing disabled), the transaction should succeed
          const block = yield* simulator.submitTransaction(createUnbalancedTx(recipientKeys));

          expect(block.transactions.length).toBe(1);
        }).pipe(Effect.scoped, Effect.runPromise);
      });
    });
  });

  describe('generic query', () => {
    it('queries state with a custom function', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          networkId: NetworkId.NetworkId.Undeployed,
        });

        // Query with a custom function that extracts network ID
        const networkId = yield* simulator.query((state) => state.networkId);
        expect(networkId).toBe(NetworkId.NetworkId.Undeployed);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('queries UTXOs for a user address', async () => {
      return Effect.gen(function* () {
        const { userAddress } = createNightKeys(1);

        const simulator = yield* Simulator.init({
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
        const { verifyingKey, userAddress } = createNightKeys(1);

        const simulator = yield* Simulator.init({
          networkId: NetworkId.NetworkId.Undeployed,
        });

        // Reward Night tokens
        yield* simulator.rewardNight(verifyingKey, 1000n);

        // Query UTXOs - Night rewards may create UTXOs
        const utxos = yield* simulator.query((state) => Array.from(state.ledger.utxo.filter(userAddress)));

        // Query should work (returns array)
        expect(Array.isArray(utxos)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('queries ledger parameters', async () => {
      return Effect.gen(function* () {
        const simulator = yield* Simulator.init({
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
        const recipientKeys = createKeys(0);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
        });

        // Create a transaction
        const tx = createUnbalancedTx(recipientKeys);

        // Calculate fees using generic query
        const fees = yield* simulator.query((state) => tx.fees(state.ledger.parameters));

        expect(fees).toBeGreaterThanOrEqual(0n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('allows complex queries combining multiple state properties', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys)],
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
          networkId: NetworkId.NetworkId.Undeployed,
        });

        // Without fullness config, should default to 0
        const feePrices = yield* simulator.query((state) => state.ledger.parameters.feePrices);
        expect(feePrices).toBeDefined();
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('applies static fullness from block producer', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        // Use genesisStrictness with custom fullness since test creates unbalanced transactions
        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys, 10000n)],
          blockProducer: immediateBlockProducer(0.9, genesisStrictness),
        });

        // Submit transactions (unbalanced - no fees) - fullness should affect ledger state updates
        const createTx = () => createUnbalancedTx(recipientKeys);

        yield* simulator.submitTransaction(createTx());
        yield* simulator.submitTransaction(createTx());

        // Fee prices should have been updated based on fullness
        const feePrices = yield* simulator.query((state) => state.ledger.parameters.feePrices);
        expect(feePrices).toBeDefined();
      }).pipe(Effect.scoped, Effect.runPromise);
    });

    it('applies dynamic fullness callback from block producer', async () => {
      return Effect.gen(function* () {
        const recipientKeys = createKeys(0);

        // Track which block numbers the callback was called with
        const calledWithBlockNumbers: bigint[] = [];
        const fullnessCallback = (state: SimulatorState): number => {
          const blockNumber = getCurrentBlockNumber(state) + 1n;
          calledWithBlockNumbers.push(blockNumber);
          return Math.min(Number(blockNumber) * 0.2, 1);
        };

        // Use genesisStrictness with dynamic fullness since test creates unbalanced transactions
        const simulator = yield* Simulator.init({
          genesisMints: [shieldedGenesisMint(recipientKeys, 10000n)],
          blockProducer: immediateBlockProducer(fullnessCallback, genesisStrictness),
        });

        // Submit transactions (unbalanced - no fees)
        const createTx = () => createUnbalancedTx(recipientKeys);

        yield* simulator.submitTransaction(createTx());
        yield* simulator.submitTransaction(createTx());

        // Callback should have been called with incrementing block numbers
        expect(calledWithBlockNumbers.length).toBe(2);
        expect(calledWithBlockNumbers[0]).toBe(1n);
        expect(calledWithBlockNumbers[1]).toBe(2n);
      }).pipe(Effect.scoped, Effect.runPromise);
    });
  });
});
