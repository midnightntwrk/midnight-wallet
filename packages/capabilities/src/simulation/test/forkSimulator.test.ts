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
 * The fork harness: one simulated chain that crosses a hard fork.
 *
 * A `ForkSimulator` drives a pre-fork (ledger-v8) chain up to the fork block, stamps that block with the fork's
 * protocol version — the signal a wallet's pre-fork variant migrates on — and then constructs a post-fork (ledger-v9)
 * chain whose block numbering continues from the fork point.
 *
 * The boundary height deliberately exists on both chains: the pre-fork chain's block `forkBlock` is a v8-format block
 * bearing the post-fork version tag (which a wallet observes but does not apply), and the post-fork chain's genesis is
 * the same height re-delivered with v9 content. That mirrors how a wallet re-fetches the boundary with the new codec.
 *
 * How value crosses the boundary is a seam — `ForkHandover`. Today the tests supply a re-mint; when the ledger ships a
 * v8 -> v9 state migration it replaces the seam's other branch without restructuring the harness.
 *
 * Every version here is arbitrary and test-supplied: the real fork version is not final and must never be hardcoded.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Fiber, Option, type Array as Arr } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ForkHandover,
  ForkSimulator,
  V8,
  genesisStrictness,
  getBlockByNumber,
  getCurrentBlockNumber,
  getLastBlock,
  getLastBlockEvents,
  immediateBlockProducer,
  type GenesisMint,
} from '../index.js';

const networkId = NetworkId.NetworkId.Undeployed;

const preForkVersion = ProtocolVersion.ProtocolVersion(3n);
const forkVersion = ProtocolVersion.ProtocolVersion(4242n);
const forkBlock = 3n;

const seed = (fill: number): Buffer => Buffer.alloc(32, fill);

const v8Keys = v8.ZswapSecretKeys.fromSeed(seed(1));
const v9Keys = v9.ZswapSecretKeys.fromSeed(seed(1));
const v8TokenType = v8.shieldedToken().raw;
const v9TokenType = v9.shieldedToken().raw;

const carriedAmount = 500n;

/** A re-mint handover: recreates `carriedAmount` of shielded value on the post-fork chain. */
const reMintHandover = (observe: (state: V8.SimulatorState) => void = () => {}): ForkHandover =>
  ForkHandover.ReMint({
    mints: (preForkState): Arr.NonEmptyArray<GenesisMint> => {
      observe(preForkState);
      return [{ type: 'shielded', tokenType: v9TokenType, amount: carriedAmount, recipient: v9Keys }];
    },
  });

/** Pre-fork genesis funding, so the pre-fork chain can do real work before the boundary. */
const v8GenesisMints: Arr.NonEmptyArray<V8.GenesisMint> = [
  { type: 'shielded', tokenType: v8TokenType, amount: 1_000_000n, recipient: v8Keys },
];

const v8Transfer = () => {
  const coin = v8.createShieldedCoinInfo(v8TokenType, 100n);
  const output = v8.ZswapOutput.new(coin, 0, v8Keys.coinPublicKey, v8Keys.encryptionPublicKey);
  const offer = v8.ZswapOffer.fromOutput<v8.PreProof>(output, v8TokenType, 100n);
  return v8.Transaction.fromParts(networkId, offer).eraseProofs();
};

const baseConfig = {
  networkId,
  forkBlock,
  forkVersion,
  preForkVersion,
  preForkGenesisMints: v8GenesisMints,
  preForkBlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
  postForkBlockProducer: immediateBlockProducer(undefined, genesisStrictness),
};

describe('ForkSimulator', () => {
  it('runs the pre-fork chain on the ledger-v8 simulator at the pre-fork version', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      const block = yield* fork.preFork.produceEmptyBlock();
      const state = yield* fork.preFork.getLatestState();

      expect(block.number).toBe(1n);
      expect(block.protocolVersion).toBe(preForkVersion);
      expect(state.ledger).toBeInstanceOf(v8.LedgerState);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('has no post-fork chain before the fork block is reached', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      // Drive the pre-fork chain to one block short of the boundary.
      yield* fork.preFork.produceEmptyBlock();
      yield* fork.preFork.produceEmptyBlock();

      const state = yield* fork.preFork.getLatestState();
      expect(V8.getCurrentBlockNumber(state)).toBe(forkBlock - 1n);
      expect(state.blocks.map((block) => block.protocolVersion)).toEqual([
        preForkVersion,
        preForkVersion,
        preForkVersion,
      ]);
      expect(Option.isNone(yield* fork.postFork())).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('stamps the fork version on the pre-fork chain at the fork block — the migration signal', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      yield* fork.advanceToFork();
      const state = yield* fork.preFork.getLatestState();

      expect(V8.getBlockByNumber(state, forkBlock)?.protocolVersion).toBe(forkVersion);
      expect(V8.getBlockByNumber(state, forkBlock - 1n)?.protocolVersion).toBe(preForkVersion);
      expect(state.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('constructs the post-fork chain once the pre-fork chain reaches the fork block', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      const postFork = yield* fork.advanceToFork();
      const afterFork = yield* fork.postFork();

      expect(Option.isSome(afterFork)).toBe(true);
      expect(Option.getOrThrow(afterFork)).toBe(postFork);
      const state = yield* postFork.getLatestState();
      expect(state.ledger).toBeInstanceOf(v9.LedgerState);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('continues post-fork block numbering from the fork block', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      const postFork = yield* fork.advanceToFork();
      const atFork = yield* postFork.getLatestState();
      const next = yield* postFork.produceEmptyBlock();

      // The boundary height is re-delivered post-fork with v9 content.
      expect(getCurrentBlockNumber(atFork)).toBe(forkBlock);
      expect(getLastBlock(atFork).protocolVersion).toBe(forkVersion);
      expect(atFork.protocolVersion).toBe(forkVersion);
      expect(next.number).toBe(forkBlock + 1n);
      expect(next.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('feeds the final pre-fork state — already at the fork version — to the handover', async () =>
    Effect.gen(function* () {
      // Test-local capture of the seam's argument; mutation confined to test setup.
      const observed: V8.SimulatorState[] = [];
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: reMintHandover((state) => observed.push(state)),
      });

      yield* fork.advanceToFork();

      expect(observed).toHaveLength(1);
      expect(V8.getCurrentBlockNumber(observed[0])).toBe(forkBlock);
      expect(observed[0].protocolVersion).toBe(forkVersion);
      // The seam sees genuine pre-fork ledger state, not a projection.
      expect(observed[0].ledger).toBeInstanceOf(v8.LedgerState);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('re-mints the carried value onto the post-fork chain, discoverable with post-fork keys', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      const postFork = yield* fork.advanceToFork();
      const state = yield* postFork.getLatestState();

      const events = getLastBlockEvents(state);
      const local = new v9.ZswapLocalState().replayEvents(v9Keys, [...events]);
      const coin = Array.from(local.coins).find((c) => c.type === v9TokenType);
      expect(coin?.value).toBe(carriedAmount);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('accepts a ledger-conversion handover in place of a re-mint', async () =>
    Effect.gen(function* () {
      // Stands in for a ledger-provided v8 -> v9 state migration: the seam supplies the post-fork ledger directly.
      const converted = v9.LedgerState.blank(networkId);
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: ForkHandover.MigrateLedger({ convert: () => converted }),
      });

      const postFork = yield* fork.advanceToFork();
      const state = yield* postFork.getLatestState();

      expect(state.ledger.serialize()).toEqual(converted.serialize());
      expect(getCurrentBlockNumber(state)).toBe(forkBlock);
      expect(getLastBlock(state).protocolVersion).toBe(forkVersion);
      expect(state.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it("carries the pre-fork chain's own transactions up to the boundary", async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      const txBlock = yield* fork.preFork.submitTransaction(v8Transfer());
      const postFork = yield* fork.advanceToFork();

      expect(txBlock.number).toBe(1n);
      expect(txBlock.protocolVersion).toBe(preForkVersion);
      expect(txBlock.transactions.length).toBeGreaterThan(0);
      const preState = yield* fork.preFork.getLatestState();
      expect(V8.getCurrentBlockNumber(preState)).toBe(forkBlock);
      expect(getCurrentBlockNumber(yield* postFork.getLatestState())).toBe(forkBlock);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('resolves awaitPostFork when transaction-driven production reaches the fork block', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      const waiting = yield* Effect.fork(fork.awaitPostFork());

      // Every submitted transfer produces one block; three of them reach the boundary.
      yield* fork.preFork.submitTransaction(v8Transfer());
      yield* fork.preFork.submitTransaction(v8Transfer());
      yield* fork.preFork.submitTransaction(v8Transfer());

      const postFork = yield* Fiber.join(waiting);
      const state = yield* postFork.getLatestState();

      expect(Option.getOrThrow(yield* fork.postFork())).toBe(postFork);
      expect(getCurrentBlockNumber(state)).toBe(forkBlock);
    }).pipe(Effect.scoped, Effect.runPromise));

  it.each([
    [1n, 2n],
    [7n, 9_999n],
    [0n, 1_234_567n],
  ])('plumbs arbitrary fork versions %s -> %s through both chains', async (before, after) =>
    Effect.gen(function* () {
      const pre = ProtocolVersion.ProtocolVersion(before);
      const post = ProtocolVersion.ProtocolVersion(after);
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        preForkVersion: pre,
        forkVersion: post,
        handover: reMintHandover(),
      });

      const postFork = yield* fork.advanceToFork();
      const preState = yield* fork.preFork.getLatestState();
      const postState = yield* postFork.getLatestState();

      expect(V8.getBlockByNumber(preState, forkBlock - 1n)?.protocolVersion).toBe(pre);
      expect(V8.getBlockByNumber(preState, forkBlock)?.protocolVersion).toBe(post);
      expect(getLastBlock(postState).protocolVersion).toBe(post);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('exposes the configured fork point', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      expect(fork.forkBlock).toBe(forkBlock);
      expect(fork.forkVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('getBlockByNumber on a forked timeline', () => {
  it('finds the boundary block on each chain independently', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      const postFork = yield* fork.advanceToFork();
      const preState = yield* fork.preFork.getLatestState();
      const postState = yield* postFork.getLatestState();

      // Same height, two chains, two codecs.
      expect(V8.getBlockByNumber(preState, forkBlock)?.protocolVersion).toBe(forkVersion);
      expect(getBlockByNumber(postState, forkBlock)?.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));
});
