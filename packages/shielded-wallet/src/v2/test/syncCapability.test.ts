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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, type SimulatorState, getLastBlockEvents } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, Option, Stream } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import {
  type EventsSyncUpdate,
  WalletSyncUpdate,
  makeEventsSyncCapability,
  makeSimulatorSyncCapability,
} from '../Sync.js';

const networkId = NetworkId.NetworkId.Undeployed;

/**
 * The boundary under test. The variant owns `[0, 7)`; anything reported at 7 or beyond belongs to the next variant and
 * must not be applied here.
 */
const activeRange = ProtocolVersion.makeRange(ProtocolVersion.ProtocolVersion(0n), ProtocolVersion.ProtocolVersion(7n));

const secretKeys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 7));

/** The six genesis mints, in ascending amount order: 100, 200, ..., 600 — 2100 in total. */
const MINT_COUNT = 6;
const MINT_TOTAL = 2100n;

const mintingSimulator = (protocolVersion?: ProtocolVersion.ProtocolVersion) =>
  Simulator.init({
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    genesisMints: Array.from({ length: MINT_COUNT }, (_, i) => ({
      type: 'shielded' as const,
      tokenType: ledger.shieldedToken().raw,
      amount: BigInt((i + 1) * 100),
      recipient: secretKeys(),
    })) as never,
  });

const simulatorStateAt = (protocolVersion?: ProtocolVersion.ProtocolVersion): Promise<SimulatorState> =>
  Effect.gen(function* () {
    const simulator = yield* mintingSimulator(protocolVersion);
    return Option.getOrThrow(yield* simulator.state$.pipe(Stream.take(1), Stream.runHead));
  }).pipe(Effect.scoped, Effect.runPromise);

/**
 * Serialized bytes of the six real `zswapOutput` events the genesis mints emit, in chain order.
 *
 * They are kept as bytes rather than as `ledger.Event` instances on purpose: `replayEventsWithChanges` consumes the
 * event objects it is handed (wasm-bindgen moves ownership), so a second use of the same instance throws. Every test
 * deserializes its own instances.
 */
let eventBytes: readonly Uint8Array[];

beforeAll(async () => {
  const state = await simulatorStateAt();
  eventBytes = getLastBlockEvents(state).map((event) => event.serialize());
  expect(eventBytes.length).toBe(MINT_COUNT);
});

/** Builds a batch of sync updates, one per `(id, protocolVersion)` pair, each carrying its own fresh event instance. */
const batch = (items: readonly (readonly [id: number, protocolVersion: number])[]): WalletSyncUpdate =>
  WalletSyncUpdate.create(
    items.map(([id, protocolVersion]): EventsSyncUpdate => ({
      _tag: 'EventsSyncUpdate',
      id,
      protocolVersion,
      maxId: MINT_COUNT,
      event: ledger.Event.deserialize(eventBytes[id - 1]),
    })),
    secretKeys(),
  );

const freshWallet = (): CoreWallet => CoreWallet.initEmpty(secretKeys(), networkId);

const coinIndices = (wallet: CoreWallet): readonly bigint[] =>
  [...wallet.state.coins].map((coin) => coin.mt_index).sort((a, b) => Number(a - b));

const totalValue = (wallet: CoreWallet): bigint => [...wallet.state.coins].reduce((sum, coin) => sum + coin.value, 0n);

describe('makeEventsSyncCapability.applyUpdate boundary handling', () => {
  const capability = makeEventsSyncCapability();

  it('applies every update and annotates the state when the whole batch is inside the active range', () => {
    const [state, result] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 3],
        [2, 3],
        [3, 3],
        [4, 3],
        [5, 3],
        [6, 3],
      ]),
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(6n);
    expect(state.progress.highestRelevantWalletIndex).toBe(BigInt(MINT_COUNT));
    expect(state.progress.isConnected).toBe(true);
    expect(state.protocolVersion).toBe(3n);
    expect(coinIndices(state)).toEqual([0n, 1n, 2n, 3n, 4n, 5n]);
    expect(totalValue(state)).toBe(MINT_TOTAL);
    expect(state.state.firstFree).toBe(6n);
    expect(result.changes.length).toBe(1);
    expect(result.changes[0].receivedCoins.length).toBe(MINT_COUNT);
    expect(result.protocolVersion).toBe(3);
  });

  it('re-annotates the state on a version bump that stays inside the active range', () => {
    const [afterFirst] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 3],
        [2, 3],
        [3, 3],
      ]),
      activeRange,
    );
    expect(afterFirst.protocolVersion).toBe(3n);

    const [state, result] = capability.applyUpdate(
      afterFirst,
      batch([
        [4, 5],
        [5, 5],
        [6, 5],
      ]),
      activeRange,
    );

    expect(state.protocolVersion).toBe(5n);
    expect(state.progress.appliedIndex).toBe(6n);
    expect(coinIndices(state)).toEqual([0n, 1n, 2n, 3n, 4n, 5n]);
    expect(totalValue(state)).toBe(MINT_TOTAL);
    expect(result.changes.length).toBe(1);
    expect(result.changes[0].receivedCoins.length).toBe(3);
  });

  it('applies only the prefix of a straddling batch and takes the version from the first suffix item', () => {
    const [state, result] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 3],
        [2, 3],
        [3, 3],
        [4, 9],
        [5, 9],
        [6, 11],
      ]),
      activeRange,
    );

    // Prefix only: the last applied id is 3, so the next variant resumes there and re-fetches ids 4-6.
    expect(state.progress.appliedIndex).toBe(3n);
    // The suffix's first version is what makes the variant hand over — not the batch's last version.
    expect(state.protocolVersion).toBe(9n);
    expect(coinIndices(state)).toEqual([0n, 1n, 2n]);
    expect(state.state.firstFree).toBe(3n);
    // Changes come from the prefix alone.
    expect(result.changes.length).toBe(1);
    expect(result.changes[0].receivedCoins.length).toBe(3);
    // The reported version tags the applied changes, so it is the prefix's version.
    expect(result.protocolVersion).toBe(3);
    // The tip is a property of the source, so it still comes from the batch tail.
    expect(state.progress.highestRelevantWalletIndex).toBe(BigInt(MINT_COUNT));
  });

  it('applies nothing when the whole batch is at or beyond the end of the active range', () => {
    const [state, result] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 7],
        [2, 7],
        [3, 9],
        [4, 9],
        [5, 9],
        [6, 9],
      ]),
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.protocolVersion).toBe(7n);
    expect(coinIndices(state)).toEqual([]);
    expect(state.state.firstFree).toBe(0n);
    expect(result.changes).toEqual([]);
    expect(state.progress.highestRelevantWalletIndex).toBe(BigInt(MINT_COUNT));
  });

  it('never lowers the recorded protocol version when a later batch reports a stale lower one', () => {
    const [afterFirst] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 5],
        [2, 5],
        [3, 5],
      ]),
      activeRange,
    );
    expect(afterFirst.protocolVersion).toBe(5n);

    const [state] = capability.applyUpdate(
      afterFirst,
      batch([
        [4, 2],
        [5, 2],
        [6, 2],
      ]),
      activeRange,
    );

    // The batch still applies; only the version annotation is held at its high-water mark.
    expect(state.protocolVersion).toBe(5n);
    expect(state.progress.appliedIndex).toBe(6n);
    expect(coinIndices(state)).toEqual([0n, 1n, 2n, 3n, 4n, 5n]);
  });

  it('leaves the state untouched for an empty batch', () => {
    const initial = freshWallet();
    const [state, result] = capability.applyUpdate(initial, WalletSyncUpdate.create([], secretKeys()), activeRange);

    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
    expect(coinIndices(state)).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.protocolVersion).toBe(Number(initial.protocolVersion));
  });
});

describe('makeSimulatorSyncCapability.applyUpdate boundary handling', () => {
  const capability = makeSimulatorSyncCapability();

  it('applies an in-range block and annotates the state with the block version', async () => {
    const simulatorState = await simulatorStateAt(ProtocolVersion.ProtocolVersion(3n));

    const [state, result] = capability.applyUpdate(
      freshWallet(),
      { update: simulatorState, secretKeys: secretKeys() },
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(1n);
    expect(state.protocolVersion).toBe(3n);
    expect(coinIndices(state)).toEqual([0n, 1n, 2n, 3n, 4n, 5n]);
    expect(totalValue(state)).toBe(MINT_TOTAL);
    expect(result.changes.length).toBe(1);
  });

  it('applies no block at or beyond the end of the active range, but still annotates the version', async () => {
    const simulatorState = await simulatorStateAt(ProtocolVersion.ProtocolVersion(9n));

    const [state, result] = capability.applyUpdate(
      freshWallet(),
      { update: simulatorState, secretKeys: secretKeys() },
      activeRange,
    );

    // The block carries six real mint events; none of them may be applied by this variant.
    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.protocolVersion).toBe(9n);
    expect(coinIndices(state)).toEqual([]);
    expect(state.state.firstFree).toBe(0n);
    expect(result.changes).toEqual([]);
  });
});
