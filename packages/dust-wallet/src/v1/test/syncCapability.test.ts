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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, identity } from 'effect';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type CoreWallet } from '../CoreWallet.js';
import {
  makeDefaultSyncCapability,
  makeSimulatorSyncCapability,
  type WalletSyncSubscription,
  WalletSyncUpdate,
} from '../Sync.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, freshWallet, fixtureSecretKey } from './dustEvents.js';

vi.setConfig({ testTimeout: 60000 });

/**
 * The boundary under test. The variant owns `[0, 7)`; anything the source reports at 7 or beyond belongs to the next
 * variant and must be left unapplied for it to fetch.
 */
const activeRange = ProtocolVersion.makeRange(ProtocolVersion.ProtocolVersion(0n), ProtocolVersion.ProtocolVersion(7n));

let chain: DustChain;

beforeAll(async () => {
  chain = await buildDustChain();
  expect(chain.eventBytes.length).toBe(DUST_EVENT_COUNT);
});

/** An event as the indexer serves it: hex, decoded by whichever variant claims it. */
const hexEventAt = (eventBytes: readonly Uint8Array[], index: number): string =>
  Buffer.from(eventBytes[index]).toString('hex');

/**
 * Builds a batch of sync updates, one per item, each carrying its own encoded event.
 *
 * A `protocolVersion` of `undefined` models an indexer that does not report the field at all — the shape dust's
 * subscription has today.
 */
const batch = (items: readonly (readonly [id: number, protocolVersion: number | undefined])[]): WalletSyncUpdate =>
  WalletSyncUpdate.create(
    items.map(([id, protocolVersion]): WalletSyncSubscription => ({
      id,
      maxId: DUST_EVENT_COUNT,
      raw: hexEventAt(chain.eventBytes, id - 1),
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
    })),
    fixtureSecretKey(),
    chain.syncTime,
  );

const utxoCount = (wallet: CoreWallet): number => wallet.state.utxos.length;

const dustBalance = (wallet: CoreWallet): bigint => wallet.state.walletBalance(chain.syncTime);

describe('makeDefaultSyncCapability.applyUpdate boundary handling', () => {
  const capability = makeDefaultSyncCapability();

  it('applies every update and annotates the state when the whole batch is inside the active range', () => {
    const [state, result] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 3],
        [2, 3],
        [3, 3],
        [4, 3],
      ]),
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(4n);
    expect(state.progress.highestRelevantWalletIndex).toBe(BigInt(DUST_EVENT_COUNT));
    expect(state.progress.isConnected).toBe(true);
    expect(state.protocolVersion).toBe(3n);
    expect(utxoCount(state)).toBe(DUST_EVENT_COUNT);
    expect(dustBalance(state)).toBeGreaterThan(0n);
    expect(result.changes.length).toBe(DUST_EVENT_COUNT);
    expect(result.protocolVersion).toBe(3);
  });

  it('re-annotates the state on a version bump that stays inside the active range', () => {
    const [afterFirst] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 3],
        [2, 3],
      ]),
      activeRange,
    );
    expect(afterFirst.protocolVersion).toBe(3n);

    const [state, result] = capability.applyUpdate(
      afterFirst,
      batch([
        [3, 5],
        [4, 5],
      ]),
      activeRange,
    );

    expect(state.protocolVersion).toBe(5n);
    expect(state.progress.appliedIndex).toBe(4n);
    expect(utxoCount(state)).toBe(DUST_EVENT_COUNT);
    expect(result.changes.length).toBe(2);
  });

  it('applies only the prefix of a straddling batch and takes the version from the first suffix item', () => {
    const [state, result] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 3],
        [2, 3],
        [3, 9],
        [4, 11],
      ]),
      activeRange,
    );

    // Prefix only: the last applied id is 2, so the next variant resumes there and re-fetches ids 3-4.
    expect(state.progress.appliedIndex).toBe(2n);
    // The suffix's first version is what makes the variant hand over — not the batch's last version.
    expect(state.protocolVersion).toBe(9n);
    expect(utxoCount(state)).toBe(2);
    // Changes come from the prefix alone.
    expect(result.changes.length).toBe(2);
    // The reported version tags the applied changes, so it is the prefix's version.
    expect(result.protocolVersion).toBe(3);
    // The tip is a property of the source, so it still comes from the batch tail.
    expect(state.progress.highestRelevantWalletIndex).toBe(BigInt(DUST_EVENT_COUNT));
  });

  it('applies nothing when the whole batch is at or beyond the end of the active range', () => {
    const [state, result] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 7],
        [2, 7],
        [3, 9],
        [4, 9],
      ]),
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.protocolVersion).toBe(7n);
    expect(utxoCount(state)).toBe(0);
    expect(result.changes).toEqual([]);
    expect(state.progress.highestRelevantWalletIndex).toBe(BigInt(DUST_EVENT_COUNT));
  });

  it('never lowers the recorded protocol version when a later batch reports a stale lower one', () => {
    const [afterFirst] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, 5],
        [2, 5],
      ]),
      activeRange,
    );
    expect(afterFirst.protocolVersion).toBe(5n);

    const [state] = capability.applyUpdate(
      afterFirst,
      batch([
        [3, 2],
        [4, 2],
      ]),
      activeRange,
    );

    // The batch still applies; only the version annotation is held at its high-water mark.
    expect(state.protocolVersion).toBe(5n);
    expect(state.progress.appliedIndex).toBe(4n);
    expect(utxoCount(state)).toBe(DUST_EVENT_COUNT);
  });

  it('leaves the state untouched for an empty batch', () => {
    const initial = freshWallet();
    const [state, result] = capability.applyUpdate(
      initial,
      WalletSyncUpdate.create([], fixtureSecretKey(), chain.syncTime),
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
    expect(utxoCount(state)).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.protocolVersion).toBe(Number(initial.protocolVersion));
  });

  // --- dust-specific: the subscription does not carry `protocolVersion` yet ---

  it('applies a batch whose items carry no protocol version at all, leaving the recorded version untouched', () => {
    const initial = freshWallet();
    const [state, result] = capability.applyUpdate(
      initial,
      batch([
        [1, undefined],
        [2, undefined],
        [3, undefined],
        [4, undefined],
      ]),
      activeRange,
    );

    // An absent version means "the indexer did not say", which is treated as in-range: apply normally...
    expect(state.progress.appliedIndex).toBe(4n);
    expect(utxoCount(state)).toBe(DUST_EVENT_COUNT);
    expect(result.changes.length).toBe(DUST_EVENT_COUNT);
    // ...and leave the annotation exactly where it was, rather than inventing a version.
    expect(state.protocolVersion).toBe(initial.protocolVersion);
    expect(result.protocolVersion).toBe(Number(initial.protocolVersion));
  });

  it('handles a mixed batch, ignoring untagged items for the boundary and splitting on the tagged one', () => {
    const [state, result] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, undefined],
        [2, 3],
        [3, 9],
        [4, undefined],
      ]),
      activeRange,
    );

    // Untagged items never trigger a hand-over; the first tagged out-of-range item still does, and everything from it
    // onwards is deferred — including the untagged item behind it, because a batch is one contiguous slice.
    expect(state.progress.appliedIndex).toBe(2n);
    expect(state.protocolVersion).toBe(9n);
    expect(utxoCount(state)).toBe(2);
    expect(result.changes.length).toBe(2);
    expect(result.protocolVersion).toBe(3);
  });

  it('keeps a mixed batch whose only tagged item is in range fully applied', () => {
    const [state] = capability.applyUpdate(
      freshWallet(),
      batch([
        [1, undefined],
        [2, 4],
        [3, undefined],
        [4, undefined],
      ]),
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(4n);
    expect(utxoCount(state)).toBe(DUST_EVENT_COUNT);
    // The last version actually observed in the batch is what gets recorded.
    expect(state.protocolVersion).toBe(4n);
  });
});

// Dust events share one id sequence with zswap and contract events in the indexer, so a dust stream is strictly
// ascending but full of gaps. Order is checked; contiguity must not be, or every honest stream would be refused.
describe('dust sync capability ordering', () => {
  const capability = makeDefaultSyncCapability();

  /** Applies a batch, capturing the throw as a Left. */
  const attempt = (
    wallet: CoreWallet,
    update: WalletSyncUpdate,
  ): Either.Either<ReturnType<typeof capability.applyUpdate>, unknown> =>
    Either.try({ try: () => capability.applyUpdate(wallet, update, activeRange), catch: identity });

  /**
   * Reads the refusal structurally: the tag and both ids are all a caller sees once the running variant re-labels the
   * throw.
   */
  const isOutOfOrderRefusal = (
    thrown: unknown,
  ): thrown is { readonly _tag: 'Wallet.OutOfOrderSyncUpdate'; readonly expected: bigint; readonly received: bigint } =>
    typeof thrown === 'object' && thrown !== null && '_tag' in thrown && thrown._tag === 'Wallet.OutOfOrderSyncUpdate';

  /** Like `batch`, but each item names the event it carries, so ids can be chosen freely and have gaps. */
  const sparseBatch = (items: readonly (readonly [id: number, eventIndex: number])[]): WalletSyncUpdate =>
    WalletSyncUpdate.create(
      items.map(([id, eventIndex]): WalletSyncSubscription => ({
        id,
        maxId: Math.max(...items.map(([itemId]) => itemId)),
        raw: hexEventAt(chain.eventBytes, eventIndex),
      })),
      fixtureSecretKey(),
      chain.syncTime,
    );

  it('applies a batch whose ids skip ahead, since the gaps belong to other event groupings', () => {
    const [afterFirst] = capability.applyUpdate(
      freshWallet(),
      sparseBatch([
        [1, 0],
        [4, 1],
        [9, 2],
      ]),
      activeRange,
    );
    expect(afterFirst.progress.appliedIndex).toBe(9n);
    expect(utxoCount(afterFirst)).toBe(3);

    // The boundary event comes back under its sparse id; the next real event sits well past it.
    const [afterSecond] = capability.applyUpdate(
      afterFirst,
      sparseBatch([
        [9, 2],
        [15, 3],
      ]),
      activeRange,
    );
    expect(afterSecond.progress.appliedIndex).toBe(15n);
    expect(utxoCount(afterSecond)).toBe(4);
  });

  it('rejects a batch whose ids are not ascending', () => {
    const wallet = freshWallet();

    const outcome = attempt(
      wallet,
      sparseBatch([
        [1, 0],
        [3, 1],
        [2, 2],
      ]),
    );

    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(isOutOfOrderRefusal(outcome.left)).toBe(true);
      if (isOutOfOrderRefusal(outcome.left)) {
        expect(outcome.left.expected).toBe(3n);
        expect(outcome.left.received).toBe(2n);
      }
    }

    // The whole batch is refused, sound prefix included.
    expect(wallet.progress.appliedIndex).toBe(0n);
    expect(utxoCount(wallet)).toBe(0);
  });

  it('rejects an id repeated within a batch', () => {
    const wallet = freshWallet();

    const outcome = attempt(
      wallet,
      sparseBatch([
        [1, 0],
        [2, 1],
        [2, 2],
      ]),
    );

    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(isOutOfOrderRefusal(outcome.left)).toBe(true);
      if (isOutOfOrderRefusal(outcome.left)) {
        expect(outcome.left.expected).toBe(2n);
        expect(outcome.left.received).toBe(2n);
      }
    }
    expect(utxoCount(wallet)).toBe(0);
  });

  it('still applies a contiguous batch after the re-delivered boundary event', () => {
    const [atFirstEvent] = capability.applyUpdate(freshWallet(), batch([[1, undefined]]), activeRange);
    expect(atFirstEvent.progress.appliedIndex).toBe(1n);
    expect(utxoCount(atFirstEvent)).toBe(1);

    // The inclusive cursor re-delivers event 1; contiguity is checked on what survives the boundary filter (2, 3).
    const [state, result] = capability.applyUpdate(
      atFirstEvent,
      batch([
        [1, undefined],
        [2, undefined],
        [3, undefined],
      ]),
      activeRange,
    );

    expect(state.progress.appliedIndex).toBe(3n);
    expect(utxoCount(state)).toBe(3);
    expect(result.changes.length).toBe(2);
  });
});

describe('makeSimulatorSyncCapability.applyUpdate boundary handling', () => {
  const capability = makeSimulatorSyncCapability();

  it('applies in-range blocks and annotates the state with the block version', async () => {
    const inRange = await buildDustChain(ProtocolVersion.ProtocolVersion(3n));

    const [state, result] = capability.applyUpdate(
      freshWallet(),
      { update: inRange.state, secretKey: fixtureSecretKey() },
      activeRange,
    );

    // Blocks 0..8: four rewards, four registrations. The next block to process is one past the last.
    expect(state.progress.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT) * 2n + 1n);
    expect(state.protocolVersion).toBe(3n);
    expect(state.state.utxos.length).toBe(DUST_EVENT_COUNT);
    expect(result.changes.length).toBe(DUST_EVENT_COUNT);
  });

  it('applies no block at or beyond the end of the active range, but still annotates the version', async () => {
    const outOfRange = await buildDustChain(ProtocolVersion.ProtocolVersion(9n));

    const [state, result] = capability.applyUpdate(
      freshWallet(),
      { update: outOfRange.state, secretKey: fixtureSecretKey() },
      activeRange,
    );

    // Every block carries a real dust event; none of them may be applied by this variant.
    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.protocolVersion).toBe(9n);
    expect(state.state.utxos.length).toBe(0);
    expect(result.changes).toEqual([]);
  });
});
