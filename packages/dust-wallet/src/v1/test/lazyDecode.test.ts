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
 * What this variant does with an event belonging to the ledger version on the other side of the boundary.
 *
 * @remarks
 *   It meets one in the ordinary course of crossing: a batch that straddles the fork carries the events that follow it,
 *   and this ledger version cannot deserialize those — the serialization header names a different version. That is not
 *   an error, it is the boundary. But a schema that decodes on arrival turns it into one, and into the worst kind: the
 *   whole batch fails, the sync stream retries, fetches the same batch, and fails again forever.
 *
 *   So the bytes cross the schema boundary as the indexer served them, and only the capability — which knows which slice
 *   of the batch it owns — reads the ones it is about to apply.
 */

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Schema } from 'effect';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { reframeAsPostFork } from '../../test/forkReplay.js';
import { type CoreWallet } from '../CoreWallet.js';
import { SyncEventsUpdateSchema, WalletSyncUpdate, makeDefaultSyncCapability, readEvent } from '../Sync.js';
import { DUST_EVENT_COUNT, type DustChain, buildDustChain, fixtureSecretKey, freshWallet } from './dustEvents.js';

// Building a real dust chain (rewards + registrations through WASM) does not fit vitest's 5s default on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

/** Where the next variant takes over. This variant owns everything below it. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

const activeRange = ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, forkVersion);

/** A version this variant owns. */
const withinRange = 3;

let chain: DustChain;

beforeAll(async () => {
  chain = await buildDustChain();
  expect(chain.eventBytes.length).toBe(DUST_EVENT_COUNT);
});

const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** An event of this variant's own ledger version, exactly as the indexer serves it. */
const ownEvent = (index: number): string => hexOf(chain.eventBytes[index]);

/**
 * The same event re-framed for the ledger version that follows this one.
 *
 * @remarks
 *   Real bytes of the other version, not a corruption: `reframeAsPostFork` rewrites only the serialization header, and
 *   `forkSimulation.test.ts` asserts that what comes out is an event the post-fork ledger reads and reconstructs the
 *   very same dust from. This variant cannot read it, which is the entire point.
 */
const nextVersionEvent = (index: number): string => hexOf(reframeAsPostFork(chain.eventBytes[index]));

/** One item as the indexer's subscription delivers it, before any of it has been read. */
const wireItem = (id: number, protocolVersion: number, raw: string): unknown => ({
  id,
  maxId: DUST_EVENT_COUNT + 1,
  raw,
  protocolVersion,
});

/** Decodes a wire item the way the sync service does, i.e. structurally and nothing more. */
const decodeItem = (item: unknown) => Schema.decodeUnknownSync(SyncEventsUpdateSchema)(item);

const utxoCount = (wallet: CoreWallet): number => wallet.state.utxos.length;

describe('a dust sync update carrying an event of the next ledger version', () => {
  it('crosses the schema boundary without being decoded', () => {
    const raw = nextVersionEvent(0);

    const decoded = Schema.decodeUnknownEither(SyncEventsUpdateSchema)(wireItem(1, Number(forkVersion), raw));

    // Whether this ledger version may read the event at all is not the subscription's question to answer. It reports
    // the id, the tip and the version, and hands the bytes on unchanged.
    expect(Either.isRight(decoded)).toBe(true);
    expect(Either.getOrThrow(decoded)).toMatchObject({ id: 1, protocolVersion: Number(forkVersion), raw });
  });

  it('is refused only when this variant is actually asked to read it', () => {
    const item = decodeItem(wireItem(1, Number(forkVersion), nextVersionEvent(0)));

    // The refusal still exists — it has moved to the one place that means something. A variant that claimed an event
    // and cannot read it has a genuine problem; a variant that never claimed it does not.
    expect(() => readEvent(item)).toThrowError();
  });

  it('is read normally when it belongs to this variant', () => {
    const item = decodeItem(wireItem(1, withinRange, ownEvent(0)));

    expect(readEvent(item)).toBeDefined();
  });
});

describe('a dust batch that straddles the boundary', () => {
  it('applies this variant’s own events and leaves the next version’s for the next variant', () => {
    const update = WalletSyncUpdate.create(
      [
        decodeItem(wireItem(1, withinRange, ownEvent(0))),
        decodeItem(wireItem(2, withinRange, ownEvent(1))),
        // The hand-over signal, and the first thing this ledger version cannot read.
        decodeItem(wireItem(3, Number(forkVersion), nextVersionEvent(2))),
        decodeItem(wireItem(4, Number(forkVersion), nextVersionEvent(3))),
      ],
      fixtureSecretKey(),
      chain.syncTime,
    );

    const [state, result] = makeDefaultSyncCapability().applyUpdate(freshWallet(), update, activeRange);

    // The batch succeeded. Before deferred decoding it could not: the whole batch was decoded on arrival, so the two
    // events this variant was never going to apply took the other two down with them, and the stream retried forever.
    expect(utxoCount(state)).toBe(2);
    expect(result.changes.length).toBe(2);
    // Parked on the last event it applied, so the next variant's inclusive cursor re-fetches the deferred suffix.
    expect(state.progress.appliedIndex).toBe(2n);
    // And carrying the version that triggers the hand-over.
    expect(state.protocolVersion).toBe(forkVersion);
  });

  it('applies nothing, and still reports the boundary, when the whole batch is the next version’s', () => {
    const update = WalletSyncUpdate.create(
      [
        decodeItem(wireItem(1, Number(forkVersion), nextVersionEvent(0))),
        decodeItem(wireItem(2, Number(forkVersion), nextVersionEvent(1))),
      ],
      fixtureSecretKey(),
      chain.syncTime,
    );

    const [state, result] = makeDefaultSyncCapability().applyUpdate(freshWallet(), update, activeRange);

    // What a wallet started from a seed on a chain that has already forked meets on its very first batch: nothing it
    // owns, and a version that says so. It must hand over rather than fail.
    expect(utxoCount(state)).toBe(0);
    expect(result.changes.length).toBe(0);
    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.protocolVersion).toBe(forkVersion);
  });
});
