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
 * How state crosses the boundary is a seam — `ForkHandover`. `TranslateLedger` converts the pre-fork chain's own ledger
 * into post-fork form, which is what the real fork does; `ReMint` recreates the value instead, an approximation kept
 * for tests that do not need translated state. The translation itself comes from a ledger-side tool behind a WASM
 * boundary, so the seam is stated in serialized bytes and as an `Effect`; until that tool is wired up, tests supply
 * it.
 *
 * Every version here is arbitrary and test-supplied: the real fork version is not final and must never be hardcoded.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Effect, Exit, Fiber, Option, pipe, type Array as Arr } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ForkHandover,
  ForkSimulator,
  LedgerTranslationError,
  V8,
  genesisStrictness,
  getBlockByNumber,
  getCurrentBlockNumber,
  getLastBlock,
  getLastBlockEvents,
  immediateBlockProducer,
  translatorFromAsync,
  unavailableTranslator,
  type GenesisMint,
  type LedgerStateTranslator,
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

  it('surfaces a handover that dies, instead of never forking', async () =>
    Effect.gen(function* () {
      // The handover runs in a background fiber. If a defect there is not propagated to whoever is waiting for the
      // fork, the waiter blocks forever and a broken handover is indistinguishable from a slow one.
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: ForkHandover.ReMint({
          mints: () => {
            throw new Error('mints exploded');
          },
        }),
      });

      const exit = yield* Effect.exit(fork.advanceToFork());

      expect(Exit.isFailure(exit)).toBe(true);
      const defect = Exit.isFailure(exit) ? Cause.dieOption(exit.cause) : Option.none();
      expect(Option.isSome(defect)).toBe(true);
      expect(Option.isNone(yield* fork.postFork())).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('exposes the configured fork point', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, handover: reMintHandover() });

      expect(fork.forkBlock).toBe(forkBlock);
      expect(fork.forkVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/**
 * The state-translation handover: the post-fork chain starts from the pre-fork chain's _own_ ledger state, converted to
 * the post-fork format, rather than from re-minted value.
 *
 * The converter is a ledger-side v8-to-v9 state translation tool, reached across a WASM boundary — so the seam is
 * stated in serialized bytes, the only thing that crosses that boundary, and as an `Effect`, so that loading the tool
 * and running it to completion (it translates incrementally, under a cost budget per step) are the translator's
 * business rather than the harness's. Until that tool is wired up, tests supply the translation.
 */
describe('ForkSimulator state-translation handover', () => {
  /** A translator that ignores its input and yields the given post-fork ledger bytes. */
  const translatorYielding =
    (bytes: Uint8Array, observe: (input: Uint8Array) => void = () => {}): LedgerStateTranslator =>
    (input) => {
      observe(input);
      return Effect.succeed(bytes);
    };

  it('hands the translator the serialized pre-fork ledger', async () =>
    Effect.gen(function* () {
      const observed: Uint8Array[] = [];
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: ForkHandover.TranslateLedger({
          translator: translatorYielding(v9.LedgerState.blank(networkId).serialize(), (input) => observed.push(input)),
        }),
      });

      yield* fork.advanceToFork();
      const preState = yield* fork.preFork.getLatestState();

      // Exactly the bytes of the pre-fork chain's ledger at the boundary — nothing reconstructed or approximated.
      expect(observed).toHaveLength(1);
      expect(observed[0]).toEqual(preState.ledger.serialize());
    }).pipe(Effect.scoped, Effect.runPromise));

  it('starts the post-fork chain from the translated state', async () =>
    Effect.gen(function* () {
      const translated = v9.LedgerState.blank(networkId);
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: ForkHandover.TranslateLedger({ translator: translatorYielding(translated.serialize()) }),
      });

      const postFork = yield* fork.advanceToFork();
      const state = yield* postFork.getLatestState();

      expect(state.ledger.serialize()).toEqual(translated.serialize());
      // The boundary invariants hold on the translation path exactly as on the re-mint path.
      expect(getCurrentBlockNumber(state)).toBe(forkBlock);
      expect(getLastBlock(state).protocolVersion).toBe(forkVersion);
      expect(state.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('supports a translator that completes asynchronously', async () =>
    Effect.gen(function* () {
      // The real translator loads WASM and runs an incremental loop; neither is instantaneous. Anything the Effect can
      // express must work, or the seam cannot hold the real tool.
      const translated = v9.LedgerState.blank(networkId);
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: ForkHandover.TranslateLedger({
          translator: () =>
            pipe(
              Effect.yieldNow(),
              Effect.flatMap(() => Effect.promise(() => Promise.resolve(translated.serialize()))),
            ),
        }),
      });

      const postFork = yield* fork.advanceToFork();
      const state = yield* postFork.getLatestState();

      expect(state.ledger.serialize()).toEqual(translated.serialize());
      expect(getCurrentBlockNumber(state)).toBe(forkBlock);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('surfaces a failing translation instead of never forking', async () =>
    Effect.gen(function* () {
      // A translation that fails must fail whoever is waiting for the fork. If it only stopped the handover, every
      // waiter would block forever and the failure would look like a hang.
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: ForkHandover.TranslateLedger({
          translator: () => Effect.fail(new LedgerTranslationError({ message: 'translation exploded' })),
        }),
      });

      const exit = yield* Effect.exit(fork.advanceToFork());

      expect(Exit.isFailure(exit)).toBe(true);
      const error = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(error)).toBe(true);
      expect(Option.getOrThrow(error)._tag).toBe('LedgerTranslationError');
      // The post-fork chain never came into existence.
      expect(Option.isNone(yield* fork.postFork())).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('fails when the translated bytes are not valid post-fork ledger state', async () =>
    Effect.gen(function* () {
      // Garbage out of the translator is a translation failure, not a crash: the harness owns deserializing the result.
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        handover: ForkHandover.TranslateLedger({
          translator: translatorYielding(new Uint8Array([0x00, 0x01, 0x02])),
        }),
      });

      const exit = yield* Effect.exit(fork.advanceToFork());

      expect(Exit.isFailure(exit)).toBe(true);
      const error = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(error)).toBe(true);
      expect(Option.getOrThrow(error)._tag).toBe('LedgerTranslationError');
    }).pipe(Effect.scoped, Effect.runPromise));

  it('offers a placeholder translator that fails until the real tool is wired up', async () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(unavailableTranslator(new Uint8Array([0x00])));

      expect(Exit.isFailure(exit)).toBe(true);
      const error = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.getOrThrow(error)._tag).toBe('LedgerTranslationError');
      expect(Option.getOrThrow(error).message).toMatch(/not (yet )?available|not wired/i);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('builds a translator from an async function, wrapping thrown errors', async () =>
    Effect.gen(function* () {
      // How the WASM tool will actually be plugged in: an async call whose failures become typed translation errors.
      const translated = v9.LedgerState.blank(networkId);
      const ok = translatorFromAsync(() => Promise.resolve(translated.serialize()));
      const boom = translatorFromAsync(() => Promise.reject(new Error('wasm blew up')));

      expect(yield* ok(new Uint8Array([0x00]))).toEqual(translated.serialize());

      const exit = yield* Effect.exit(boom(new Uint8Array([0x00])));
      expect(Exit.isFailure(exit)).toBe(true);
      const error = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.getOrThrow(error)._tag).toBe('LedgerTranslationError');
      expect(Option.getOrThrow(error).cause).toBeInstanceOf(Error);
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
