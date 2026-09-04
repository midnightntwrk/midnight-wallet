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
 * Version-timeline behaviour, asserted identically against both simulator twins.
 *
 * A simulated chain carries a protocol version: every block is stamped with the version in force when it was produced,
 * and a fork can be scheduled to activate a new version at a given block height. This is what lets a wallet under test
 * observe the version change that drives variant migration.
 *
 * The pre-fork (ledger-v8) and post-fork (ledger-v9) simulators are import-swap twins, so the timeline contract must
 * hold for both. Each fixture wraps its own simulator and exposes only the version-relevant surface, keeping the shared
 * assertions free of ledger-specific types.
 *
 * Every version used here is arbitrary and supplied by the test — the real fork version is not final, so nothing about
 * it may be hardcoded in the simulators.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { Simulator, immediateBlockProducer, genesisStrictness, V8 } from '../index.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** The version-carrying part of a produced block. */
type TimelineBlock = Readonly<{
  number: bigint;
  protocolVersion: ProtocolVersion.ProtocolVersion;
}>;

/** The version-carrying part of simulator state. */
type TimelineState = Readonly<{
  protocolVersion: ProtocolVersion.ProtocolVersion;
  blocks: readonly TimelineBlock[];
}>;

/** Ledger-agnostic handle over a simulator, exposing only what the timeline assertions need. */
type TimelineSimulator = Readonly<{
  getLatestState: () => Effect.Effect<TimelineState>;
  setProtocolVersion: (version: ProtocolVersion.ProtocolVersion) => Effect.Effect<void>;
  scheduleFork: (atBlock: bigint, version: ProtocolVersion.ProtocolVersion) => Effect.Effect<void>;
  produceEmptyBlock: () => Effect.Effect<TimelineBlock, LedgerOps.LedgerError>;
  /** Submits a shielded transfer and waits for its block — exercises the transaction block-production path. */
  submitTransfer: () => Effect.Effect<TimelineBlock, LedgerOps.LedgerError>;
}>;

type TimelineFixture = Readonly<{
  name: string;
  init: (config: {
    protocolVersion?: ProtocolVersion.ProtocolVersion;
  }) => Effect.Effect<TimelineSimulator, never, Scope.Scope>;
}>;

const seed = (fill: number): Buffer => Buffer.alloc(32, fill);

const v9Fixture: TimelineFixture = {
  name: 'post-fork (ledger-v9)',
  init: (config) =>
    Effect.gen(function* () {
      const keys = v9.ZswapSecretKeys.fromSeed(seed(1));
      const tokenType = v9.shieldedToken().raw;
      const simulator = yield* Simulator.init({
        ...(config.protocolVersion !== undefined ? { protocolVersion: config.protocolVersion } : {}),
        networkId,
        genesisMints: [{ type: 'shielded', tokenType, amount: 1_000_000n, recipient: keys }],
        blockProducer: immediateBlockProducer(undefined, genesisStrictness),
      });
      const makeTransfer = () => {
        const coin = v9.createShieldedCoinInfo(tokenType, 100n);
        const output = v9.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
        const offer = v9.ZswapOffer.fromOutput<v9.PreProof>(output, tokenType, 100n);
        return v9.Transaction.fromParts(networkId, offer).eraseProofs();
      };
      return {
        getLatestState: () =>
          Effect.map(simulator.getLatestState(), (state) => ({
            protocolVersion: state.protocolVersion,
            blocks: state.blocks.map((block) => ({ number: block.number, protocolVersion: block.protocolVersion })),
          })),
        setProtocolVersion: (version) => simulator.setProtocolVersion(version),
        scheduleFork: (atBlock, version) => simulator.scheduleFork(atBlock, version),
        produceEmptyBlock: () => simulator.produceEmptyBlock(),
        submitTransfer: () => simulator.submitTransaction(makeTransfer()),
      };
    }),
};

const v8Fixture: TimelineFixture = {
  name: 'pre-fork (ledger-v8)',
  init: (config) =>
    Effect.gen(function* () {
      const keys = v8.ZswapSecretKeys.fromSeed(seed(1));
      const tokenType = v8.shieldedToken().raw;
      const simulator = yield* V8.Simulator.init({
        ...(config.protocolVersion !== undefined ? { protocolVersion: config.protocolVersion } : {}),
        networkId,
        genesisMints: [{ type: 'shielded', tokenType, amount: 1_000_000n, recipient: keys }],
        blockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
      });
      const makeTransfer = () => {
        const coin = v8.createShieldedCoinInfo(tokenType, 100n);
        const output = v8.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
        const offer = v8.ZswapOffer.fromOutput<v8.PreProof>(output, tokenType, 100n);
        return v8.Transaction.fromParts(networkId, offer).eraseProofs();
      };
      return {
        getLatestState: () =>
          Effect.map(simulator.getLatestState(), (state) => ({
            protocolVersion: state.protocolVersion,
            blocks: state.blocks.map((block) => ({ number: block.number, protocolVersion: block.protocolVersion })),
          })),
        setProtocolVersion: (version) => simulator.setProtocolVersion(version),
        scheduleFork: (atBlock, version) => simulator.scheduleFork(atBlock, version),
        produceEmptyBlock: () => simulator.produceEmptyBlock(),
        submitTransfer: () => simulator.submitTransaction(makeTransfer()),
      };
    }),
};

describe.each([v8Fixture, v9Fixture])('$name simulator version timeline', (fixture) => {
  it('stamps the minimum supported version when none is configured', async () =>
    Effect.gen(function* () {
      const simulator = yield* fixture.init({});

      const state = yield* simulator.getLatestState();

      expect(state.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
      expect(state.blocks[0].protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('stamps the configured initial version on genesis and on every later block', async () =>
    Effect.gen(function* () {
      const initial = ProtocolVersion.ProtocolVersion(3n);
      const simulator = yield* fixture.init({ protocolVersion: initial });

      const first = yield* simulator.produceEmptyBlock();
      const second = yield* simulator.produceEmptyBlock();
      const state = yield* simulator.getLatestState();

      expect([first.number, second.number]).toEqual([1n, 2n]);
      expect(state.blocks.map((block) => block.protocolVersion)).toEqual([initial, initial, initial]);
      expect(state.protocolVersion).toBe(initial);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('stamps blocks produced from transactions, not only empty blocks', async () =>
    Effect.gen(function* () {
      const initial = ProtocolVersion.ProtocolVersion(3n);
      const simulator = yield* fixture.init({ protocolVersion: initial });

      const block = yield* simulator.submitTransfer();

      expect(block.number).toBe(1n);
      expect(block.protocolVersion).toBe(initial);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('applies setProtocolVersion only to blocks produced after the call', async () =>
    Effect.gen(function* () {
      const before = ProtocolVersion.ProtocolVersion(3n);
      const after = ProtocolVersion.ProtocolVersion(9n);
      const simulator = yield* fixture.init({ protocolVersion: before });

      const preChange = yield* simulator.produceEmptyBlock();
      yield* simulator.setProtocolVersion(after);
      const postChange = yield* simulator.produceEmptyBlock();

      expect(preChange.protocolVersion).toBe(before);
      expect(postChange.protocolVersion).toBe(after);
      // History is never rewritten: the already-produced block keeps the version it was produced under.
      const state = yield* simulator.getLatestState();
      expect(state.blocks.map((block) => block.protocolVersion)).toEqual([before, before, after]);
      expect(state.protocolVersion).toBe(after);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('activates a scheduled fork exactly at the scheduled block', async () =>
    Effect.gen(function* () {
      const preFork = ProtocolVersion.ProtocolVersion(3n);
      const forkVersion = ProtocolVersion.ProtocolVersion(4242n);
      const simulator = yield* fixture.init({ protocolVersion: preFork });

      yield* simulator.scheduleFork(3n, forkVersion);
      const first = yield* simulator.produceEmptyBlock();
      const second = yield* simulator.produceEmptyBlock();
      const third = yield* simulator.produceEmptyBlock();
      const fourth = yield* simulator.produceEmptyBlock();

      expect([first.number, second.number, third.number, fourth.number]).toEqual([1n, 2n, 3n, 4n]);
      expect([first.protocolVersion, second.protocolVersion]).toEqual([preFork, preFork]);
      expect([third.protocolVersion, fourth.protocolVersion]).toEqual([forkVersion, forkVersion]);

      const state = yield* simulator.getLatestState();
      expect(state.blocks.map((block) => block.protocolVersion)).toEqual([
        preFork,
        preFork,
        preFork,
        forkVersion,
        forkVersion,
      ]);
      expect(state.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('leaves the chain on the pre-fork version until the fork block is reached', async () =>
    Effect.gen(function* () {
      const preFork = ProtocolVersion.ProtocolVersion(3n);
      const forkVersion = ProtocolVersion.ProtocolVersion(4242n);
      const simulator = yield* fixture.init({ protocolVersion: preFork });

      yield* simulator.scheduleFork(5n, forkVersion);
      const block = yield* simulator.produceEmptyBlock();

      expect(block.protocolVersion).toBe(preFork);
      expect((yield* simulator.getLatestState()).protocolVersion).toBe(preFork);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('applies a fork scheduled at an already-produced block to the next block only', async () =>
    Effect.gen(function* () {
      const preFork = ProtocolVersion.ProtocolVersion(3n);
      const forkVersion = ProtocolVersion.ProtocolVersion(4242n);
      const simulator = yield* fixture.init({ protocolVersion: preFork });

      yield* simulator.produceEmptyBlock();
      yield* simulator.produceEmptyBlock();
      yield* simulator.scheduleFork(1n, forkVersion);
      const next = yield* simulator.produceEmptyBlock();

      expect(next.number).toBe(3n);
      expect(next.protocolVersion).toBe(forkVersion);
      const state = yield* simulator.getLatestState();
      expect(state.blocks.map((block) => block.protocolVersion)).toEqual([preFork, preFork, preFork, forkVersion]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it.each([
    [1n, 2n],
    [7n, 9_999n],
    [0n, 1_234_567n],
  ])('carries arbitrary versions %s -> %s across the fork — nothing is hardcoded', async (before, after) =>
    Effect.gen(function* () {
      const preFork = ProtocolVersion.ProtocolVersion(before);
      const forkVersion = ProtocolVersion.ProtocolVersion(after);
      const simulator = yield* fixture.init({ protocolVersion: preFork });

      yield* simulator.scheduleFork(2n, forkVersion);
      const first = yield* simulator.produceEmptyBlock();
      const second = yield* simulator.produceEmptyBlock();

      expect(first.protocolVersion).toBe(preFork);
      expect(second.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});
