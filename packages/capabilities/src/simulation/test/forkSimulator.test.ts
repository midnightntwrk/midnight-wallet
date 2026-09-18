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
 * A `ForkSimulator` drives a ledger-v8 chain up to the fork block, stamps that block with the fork's protocol version —
 * the signal a wallet's V1 variant migrates on — and then constructs a ledger-v9 chain whose block numbering continues
 * from the fork point.
 *
 * The boundary height deliberately exists on both chains: the ledger-v8 chain's block `forkBlock` is a v8-format block
 * bearing the ledger-v9 version tag (which a wallet observes but does not apply), and the ledger-v9 chain's genesis is
 * the same height re-delivered with v9 content. That mirrors how a wallet re-fetches the boundary with the new codec.
 *
 * How state crosses the boundary is a seam — the `translator`, which converts the ledger-v8 chain's own ledger into
 * ledger-v9 form. The real translation links both ledgers at once behind a WASM boundary, so the seam is stated in
 * serialized bytes and as an `Effect`; these tests supply it themselves, which is what pins the seam's shape
 * independently of the artifact. The real translation in that slot is `forkStateTranslation.integration.test.ts`.
 *
 * Every version here is arbitrary and test-supplied: the real fork version is not final and must never be hardcoded.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Effect, Exit, Fiber, Option, pipe, type Array as Arr } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ForkSimulator,
  LedgerTranslationError,
  V8,
  genesisStrictness,
  getBlockByNumber,
  getCurrentBlockNumber,
  getLastBlock,
  immediateBlockProducer,
  translatorFromAsync,
  unavailableTranslator,
  type LedgerStateTranslator,
} from '../index.js';

const networkId = NetworkId.NetworkId.Undeployed;

const v8Version = ProtocolVersion.ProtocolVersion(3n);
const forkVersion = ProtocolVersion.ProtocolVersion(4242n);
const forkBlock = 3n;

const seed = (fill: number): Buffer => Buffer.alloc(32, fill);

const v8Keys = ledgerV8.ZswapSecretKeys.fromSeed(seed(1));
const v8TokenType = ledgerV8.shieldedToken().raw;

/**
 * A translator that ignores its input and yields the given ledger-v9 bytes.
 *
 * Stands in for the real WASM translation, which these tests deliberately do not use: it needs a built artifact, and
 * what is under test here is the harness around the seam rather than the translation itself. That lives in
 * `forkStateTranslation.integration.test.ts`.
 */
const translatorYielding =
  (bytes: Uint8Array, observe: (input: Uint8Array) => void = () => {}): LedgerStateTranslator =>
  (input) => {
    observe(input);
    return Effect.succeed(bytes);
  };

/** The ledger-v9 starting state for tests that only care about the harness, not about what crossed. */
const blankV9 = (): LedgerStateTranslator => translatorYielding(ledgerV9.LedgerState.blank(networkId).serialize());

/** Ledger-v8 genesis funding, so the ledger-v8 chain can do real work before the boundary. */
const v8GenesisMints: Arr.NonEmptyArray<V8.GenesisMint> = [
  { type: 'shielded', tokenType: v8TokenType, amount: 1_000_000n, recipient: v8Keys },
];

const v8Transfer = () => {
  const coin = ledgerV8.createShieldedCoinInfo(v8TokenType, 100n);
  const output = ledgerV8.ZswapOutput.new(coin, 0, v8Keys.coinPublicKey, v8Keys.encryptionPublicKey);
  const offer = ledgerV8.ZswapOffer.fromOutput<ledgerV8.PreProof>(output, v8TokenType, 100n);
  return ledgerV8.Transaction.fromParts(networkId, offer).eraseProofs();
};

const baseConfig = {
  networkId,
  forkBlock,
  forkVersion,
  v8Version,
  v8GenesisMints: v8GenesisMints,
  v8BlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
  v9BlockProducer: immediateBlockProducer(undefined, genesisStrictness),
};

describe('ForkSimulator', () => {
  it('runs the ledger-v8 chain on the ledger-v8 simulator at the ledger-v8 version', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      const block = yield* fork.v8.produceEmptyBlock();
      const state = yield* fork.v8.getLatestState();

      expect(block.number).toBe(1n);
      expect(block.protocolVersion).toBe(v8Version);
      expect(state.ledger).toBeInstanceOf(ledgerV8.LedgerState);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('has no ledger-v9 chain before the v9 fork block is reached', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      // Drive the ledger-v8 chain to one block short of the boundary.
      yield* fork.v8.produceEmptyBlock();
      yield* fork.v8.produceEmptyBlock();

      const state = yield* fork.v8.getLatestState();
      expect(V8.getCurrentBlockNumber(state)).toBe(forkBlock - 1n);
      expect(state.blocks.map((block) => block.protocolVersion)).toEqual([v8Version, v8Version, v8Version]);
      expect(Option.isNone(yield* fork.v9())).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('stamps the fork version on the ledger-v8 chain at the fork block — the migration signal', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      yield* fork.advanceToFork();
      const state = yield* fork.v8.getLatestState();

      expect(V8.getBlockByNumber(state, forkBlock)?.protocolVersion).toBe(forkVersion);
      expect(V8.getBlockByNumber(state, forkBlock - 1n)?.protocolVersion).toBe(v8Version);
      expect(state.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('constructs the ledger-v9 chain once the ledger-v8 chain reaches the fork block', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      const v9Chain = yield* fork.advanceToFork();
      const v9Published = yield* fork.v9();

      expect(Option.isSome(v9Published)).toBe(true);
      expect(Option.getOrThrow(v9Published)).toBe(v9Chain);
      const state = yield* v9Chain.getLatestState();
      expect(state.ledger).toBeInstanceOf(ledgerV9.LedgerState);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('continues ledger-v9 block numbering from the fork block', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      const v9Chain = yield* fork.advanceToFork();
      const atFork = yield* v9Chain.getLatestState();
      const next = yield* v9Chain.produceEmptyBlock();

      // The boundary height is re-delivered ledger-v9 with v9 content.
      expect(getCurrentBlockNumber(atFork)).toBe(forkBlock);
      expect(getLastBlock(atFork).protocolVersion).toBe(forkVersion);
      expect(atFork.protocolVersion).toBe(forkVersion);
      expect(next.number).toBe(forkBlock + 1n);
      expect(next.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it("carries the ledger-v8 chain's own transactions up to the boundary", async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      const txBlock = yield* fork.v8.submitTransaction(v8Transfer());
      const v9Chain = yield* fork.advanceToFork();

      expect(txBlock.number).toBe(1n);
      expect(txBlock.protocolVersion).toBe(v8Version);
      expect(txBlock.transactions.length).toBeGreaterThan(0);
      const preState = yield* fork.v8.getLatestState();
      expect(V8.getCurrentBlockNumber(preState)).toBe(forkBlock);
      expect(getCurrentBlockNumber(yield* v9Chain.getLatestState())).toBe(forkBlock);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('resolves awaitV9 when transaction-driven production reaches the fork block', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      const waiting = yield* Effect.fork(fork.awaitV9());

      // Every submitted transfer produces one block; three of them reach the boundary.
      yield* fork.v8.submitTransaction(v8Transfer());
      yield* fork.v8.submitTransaction(v8Transfer());
      yield* fork.v8.submitTransaction(v8Transfer());

      const v9Chain = yield* Fiber.join(waiting);
      const state = yield* v9Chain.getLatestState();

      expect(Option.getOrThrow(yield* fork.v9())).toBe(v9Chain);
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
        v8Version: pre,
        forkVersion: post,
        translator: blankV9(),
      });

      const v9Chain = yield* fork.advanceToFork();
      const preState = yield* fork.v8.getLatestState();
      const postState = yield* v9Chain.getLatestState();

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
        translator: () => Effect.die(new Error('translator exploded')),
      });

      const exit = yield* Effect.exit(fork.advanceToFork());

      expect(Exit.isFailure(exit)).toBe(true);
      const defect = Exit.isFailure(exit) ? Cause.dieOption(exit.cause) : Option.none();
      expect(Option.isSome(defect)).toBe(true);
      expect(Option.isNone(yield* fork.v9())).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('exposes the configured fork point', async () =>
    Effect.gen(function* () {
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      expect(fork.forkBlock).toBe(forkBlock);
      expect(fork.forkVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/**
 * The state-translation handover: the ledger-v9 chain starts from the ledger-v8 chain's _own_ ledger state, converted
 * to the ledger-v9 format, rather than from re-minted value.
 *
 * The converter is a ledger-side v8-to-v9 state translation tool, reached across a WASM boundary — so the seam is
 * stated in serialized bytes, the only thing that crosses that boundary, and as an `Effect`, so that loading the tool
 * and running it to completion (it translates incrementally, under a cost budget per step) are the translator's
 * business rather than the harness's. Until that tool is wired up, tests supply the translation.
 */
describe('ForkSimulator state-translation handover', () => {
  it('hands the translator the serialized ledger-v8', async () =>
    Effect.gen(function* () {
      const observed: Uint8Array[] = [];
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        translator: translatorYielding(ledgerV9.LedgerState.blank(networkId).serialize(), (input) =>
          observed.push(input),
        ),
      });

      yield* fork.advanceToFork();
      const preState = yield* fork.v8.getLatestState();

      // Exactly the bytes of the ledger-v8 chain's ledger at the boundary — nothing reconstructed or approximated.
      expect(observed).toHaveLength(1);
      expect(observed[0]).toEqual(preState.ledger.serialize());
    }).pipe(Effect.scoped, Effect.runPromise));

  it('starts the ledger-v9 chain from the translated state', async () =>
    Effect.gen(function* () {
      const translated = ledgerV9.LedgerState.blank(networkId);
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        translator: translatorYielding(translated.serialize()),
      });

      const v9Chain = yield* fork.advanceToFork();
      const state = yield* v9Chain.getLatestState();

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
      const translated = ledgerV9.LedgerState.blank(networkId);
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        translator: () =>
          pipe(
            Effect.yieldNow(),
            Effect.flatMap(() => Effect.promise(() => Promise.resolve(translated.serialize()))),
          ),
      });

      const v9Chain = yield* fork.advanceToFork();
      const state = yield* v9Chain.getLatestState();

      expect(state.ledger.serialize()).toEqual(translated.serialize());
      expect(getCurrentBlockNumber(state)).toBe(forkBlock);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('surfaces a failing translation instead of never forking', async () =>
    Effect.gen(function* () {
      // A translation that fails must fail whoever is waiting for the fork. If it only stopped the handover, every
      // waiter would block forever and the failure would look like a hang.
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        translator: () => Effect.fail(new LedgerTranslationError({ message: 'translation exploded' })),
      });

      const exit = yield* Effect.exit(fork.advanceToFork());

      expect(Exit.isFailure(exit)).toBe(true);
      const error = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(error)).toBe(true);
      expect(Option.getOrThrow(error)._tag).toBe('LedgerTranslationError');
      // The ledger-v9 chain never came into existence.
      expect(Option.isNone(yield* fork.v9())).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('fails when the translated bytes are not valid ledger-v9 state', async () =>
    Effect.gen(function* () {
      // Garbage out of the translator is a translation failure, not a crash: the harness owns deserializing the result.
      const fork = yield* ForkSimulator.init({
        ...baseConfig,
        translator: translatorYielding(new Uint8Array([0x00, 0x01, 0x02])),
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
      const translated = ledgerV9.LedgerState.blank(networkId);
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
      const fork = yield* ForkSimulator.init({ ...baseConfig, translator: blankV9() });

      const v9Chain = yield* fork.advanceToFork();
      const preState = yield* fork.v8.getLatestState();
      const postState = yield* v9Chain.getLatestState();

      // Same height, two chains, two codecs.
      expect(V8.getBlockByNumber(preState, forkBlock)?.protocolVersion).toBe(forkVersion);
      expect(getBlockByNumber(postState, forkBlock)?.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));
});
