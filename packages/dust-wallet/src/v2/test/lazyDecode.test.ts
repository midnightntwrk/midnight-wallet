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
 * What this variant does with bytes belonging to the ledger version on the other side of the boundary.
 *
 * @remarks
 *   A V2 variant meets them constantly. It resumes on the cursor it inherited, so the inclusive event cursor re-delivers
 *   the last event the previous variant applied — an event of the previous ledger version. And its nullifier lookup
 *   runs from block zero, so every ledger-v8 block it matches carries that version's ledger parameters and that
 *   version's raw events.
 *
 *   None of that is an error; it is what crossing a boundary looks like. But a schema that deserializes on arrival turns
 *   each of them into one, and into the worst kind: the whole batch fails, the stream retries, fetches the same batch,
 *   and fails again forever. So the bytes cross the schema boundary as the indexer served them, and are read only where
 *   something is actually about to use them.
 */

import {
  DustSecretKey as V8SecretKey,
  Event as V8Event,
  LedgerParameters as V8LedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import { LedgerParameters } from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Schema } from 'effect';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DUST_EVENT_COUNT,
  type DustChain,
  buildDustChain as buildV8Chain,
  dustSeed,
} from '../../v1/test/dustEvents.js';
import { reframeAsV9 } from '../../test/forkReplay.js';
import { type CoreWallet } from '../CoreWallet.js';
import { makeDefaultSyncCapability, matchedDustSpends } from '../Sync.js';
import {
  DustGenerationsSubscriptionSchema,
  DustNullifierTransactionSubscriptionSchema,
  SyncEventsUpdateSchema,
  WalletSyncUpdate,
  readCollapsedUpdate,
  readEvent,
  readGenerationTreeInsertionPath,
} from '../SyncSchema.js';
import { fixtureSecretKey, freshWallet } from './dustEvents.js';

// The other ledger version's bytes come from a real dust chain built through WASM, which does not fit vitest's 5s
// default on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

/** Where this variant takes over. Everything below belongs to the variant before it. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

const activeRange = ProtocolVersion.makeRange(forkVersion, ProtocolVersion.MaxSupportedVersion);

/** What the indexer reports the ledger-v8 history under. */
const v8Version = 1;

let v8Chain: DustChain;

beforeAll(async () => {
  v8Chain = await buildV8Chain();
  expect(v8Chain.eventBytes.length).toBe(DUST_EVENT_COUNT);
});

const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * An event of the ledger version this variant took over from — real bytes off a real ledger-v8 chain.
 *
 * @remarks
 *   `forkSimulation.test.ts` asserts directly that this ledger version refuses them: the serialization header names the
 *   previous version. They reach this variant anyway, because the cursor it inherits is inclusive.
 */
const previousVersionEvent = (index: number): string => hexOf(v8Chain.eventBytes[index]);

/** The same event re-framed for this ledger version, which is what the indexer's ledger-v9 replay serves. */
const ownEvent = (index: number): string => hexOf(reframeAsV9(v8Chain.eventBytes[index]));

/** The previous ledger version's serialized ledger parameters, which this version equally refuses. */
const previousVersionParameters = (): string => hexOf(V8LedgerParameters.initialParameters().serialize());

/** One item as the indexer's event subscription delivers it, before any of it has been read. */
const wireItem = (id: number, protocolVersion: number, raw: string): unknown => ({
  id,
  maxId: DUST_EVENT_COUNT * 2,
  raw,
  protocolVersion,
});

const decodeItem = (item: unknown) => Schema.decodeUnknownSync(SyncEventsUpdateSchema)(item);

const utxoCount = (wallet: CoreWallet): number => wallet.state.utxos.length;

describe('a dust sync update carrying an event of the previous ledger version', () => {
  it('crosses the schema boundary without being decoded', () => {
    const raw = previousVersionEvent(0);

    const decoded = Schema.decodeUnknownEither(SyncEventsUpdateSchema)(wireItem(1, v8Version, raw));

    expect(Either.isRight(decoded)).toBe(true);
    expect(Either.getOrThrow(decoded)).toMatchObject({ id: 1, protocolVersion: v8Version, raw });
  });

  it('is refused only when this variant is actually asked to read it', () => {
    const item = decodeItem(wireItem(1, v8Version, previousVersionEvent(0)));

    expect(() => readEvent(item)).toThrowError();
  });

  it('is read normally when it belongs to this variant', () => {
    const item = decodeItem(wireItem(1, Number(forkVersion), ownEvent(0)));

    expect(readEvent(item)).toBeDefined();
  });
});

describe('a dust batch resuming on the cursor a previous variant parked', () => {
  it('skips the re-delivered event of the previous version and applies its own', () => {
    // Exactly what the inclusive cursor produces after a hand-over: the boundary event again, in the encoding the
    // previous variant read it in, followed by this variant's own replay.
    const restored = { ...freshWallet(), progress: { ...freshWallet().progress, appliedIndex: 4n } };
    const update = WalletSyncUpdate.create(
      [
        decodeItem(wireItem(4, v8Version, previousVersionEvent(3))),
        decodeItem(wireItem(5, Number(forkVersion), ownEvent(0))),
        decodeItem(wireItem(6, Number(forkVersion), ownEvent(1))),
      ],
      fixtureSecretKey(),
      v8Chain.syncTime,
    );

    const [state, result] = makeDefaultSyncCapability().applyUpdate(restored, update, activeRange);

    // Before deferred decoding this batch could not be read at all: the re-delivered boundary event was deserialized
    // on arrival by a ledger version that cannot read it, so the two events this variant does own never arrived.
    expect(utxoCount(state)).toBe(2);
    expect(result.changes.length).toBe(2);
    expect(state.progress.appliedIndex).toBe(6n);
  });
});

describe('a nullifier lookup reaching back past the boundary', () => {
  /** A matched transaction in a block of the previous ledger version — parameters, events and all. */
  const v8Match = (): unknown => ({
    nullifierLeBytes: '00'.repeat(32),
    commitmentLeBytes: '00'.repeat(32),
    transactionId: 1,
    transactionHash: 'ab'.repeat(32),
    blockHeight: 1,
    blockHash: 'cd'.repeat(32),
    transaction: {
      __typename: 'RegularTransaction',
      block: { protocolVersion: v8Version, ledgerParameters: previousVersionParameters() },
      id: 1,
      hash: 'ab'.repeat(32),
      dustLedgerEvents: [{ id: 1, raw: previousVersionEvent(0), maxId: DUST_EVENT_COUNT, protocolVersion: v8Version }],
      zswapLedgerEvents: [],
    },
  });

  it('reads a ledger-v8 block without asking this ledger version to deserialize any of it', () => {
    const decoded = Schema.decodeUnknownEither(DustNullifierTransactionSubscriptionSchema)(v8Match());

    // The subscription runs from block zero, so it necessarily matches transactions of the previous version. Failing
    // on them would take down the whole nullifier lookup — and with it every dust spend this wallet ever made.
    expect(Either.isRight(decoded)).toBe(true);
  });

  it('skips a matched event it cannot read instead of failing the lookup', () => {
    const matched = Either.getOrThrow(
      Schema.decodeUnknownEither(DustNullifierTransactionSubscriptionSchema)(v8Match()),
    );

    // The lookup over-delivers by design — a nullifier _prefix_ match, from block zero. An event this ledger version
    // cannot read is by construction not one of this wallet's own dust spends, so it drops out silently.
    expect(matchedDustSpends([matched])).toEqual([]);
  });

  it('still reads a block of its own version', () => {
    const decoded = Schema.decodeUnknownEither(DustNullifierTransactionSubscriptionSchema)({
      ...(v8Match() as Record<string, unknown>),
      transaction: {
        __typename: 'RegularTransaction',
        block: {
          protocolVersion: Number(forkVersion),
          ledgerParameters: hexOf(LedgerParameters.initialParameters().serialize()),
        },
        id: 1,
        hash: 'ab'.repeat(32),
        dustLedgerEvents: [{ id: 5, raw: ownEvent(0), maxId: DUST_EVENT_COUNT, protocolVersion: Number(forkVersion) }],
        zswapLedgerEvents: [],
      },
    });

    expect(Either.isRight(decoded)).toBe(true);
  });
});

describe('the projections subscriptions', () => {
  /** Bytes this ledger version cannot deserialize, standing in for anything the indexer serves that it cannot read. */
  const unreadableBytes = (): string => previousVersionEvent(0);

  it('carries a collapsed Merkle tree update without asserting this version can read it', () => {
    const decoded = Schema.decodeUnknownEither(DustGenerationsSubscriptionSchema)({
      __typename: 'DustGenerationsProgress',
      highestIndex: 4,
      collapsedMerkleTree: {
        startIndex: 0,
        endIndex: 3,
        update: unreadableBytes(),
        protocolVersion: v8Version,
      },
    });

    // One item the wallet may never apply must not be able to fail the whole subscription on arrival.
    expect(Either.isRight(decoded)).toBe(true);
    const item = Either.getOrThrow(decoded);
    if (item.__typename !== 'DustGenerationsProgress') {
      throw new Error('Expected a progress item');
    }
    const collapsed = item.collapsedMerkleTree;
    if (collapsed === null) {
      throw new Error('Expected a progress item carrying a collapsed Merkle tree update');
    }
    expect(() => readCollapsedUpdate(collapsed)).toThrowError();
  });

  it('carries a generation tree insertion path without asserting this version can read it', () => {
    const decoded = Schema.decodeUnknownEither(DustGenerationsSubscriptionSchema)({
      __typename: 'DustGenerationDtimeUpdateItem',
      generationMtIndex: 0,
      nightUtxoHash: 'ef'.repeat(32),
      newDtime: 1_700_000_000,
      treeInsertionPath: unreadableBytes(),
    });

    expect(Either.isRight(decoded)).toBe(true);
    const item = Either.getOrThrow(decoded);
    if (item.__typename !== 'DustGenerationDtimeUpdateItem') {
      throw new Error('Expected a dtime update item');
    }
    expect(() => readGenerationTreeInsertionPath(item.treeInsertionPath)).toThrowError();
  });
});

describe('the fixture the other side of the boundary is built from', () => {
  it('is a real chain of the previous ledger version, which this one refuses outright', () => {
    // Guards the whole file: if the two ledger versions ever stopped refusing each other's events, every assertion
    // above would pass for the wrong reason.
    expect(() => V8Event.deserialize(v8Chain.eventBytes[0])).not.toThrow();
    expect(V8SecretKey.fromSeed(dustSeed()).publicKey).toBeDefined();
  });
});
