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
import {
  DustSecretKey,
  dustFirstNonce,
  dustNullifier,
  type Event as LedgerEvent,
  LedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustLedgerEvents, DustNullifierTransactions } from '@midnightntwrk/wallet-sdk-indexer-client';
import type {
  DustLedgerEventsSubscription,
  DustLedgerEventsSubscriptionVariables,
  DustNullifierTransactionsSubscription as WireDustNullifierTransactionsSubscription,
  DustNullifierTransactionsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { type ClientError, type ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Chunk, Effect, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import {
  createDustUtxoUpdates,
  makeDefaultSyncService,
  makeEventLessSyncCapability,
  makeIndexerSyncService,
  nullifierPhaseProgress,
} from '../Sync.js';
import {
  type DustNullifierTransactionsSubscription,
  type DustSpendProcessedEvent,
  DustUtxoMap,
  StateUpdate,
} from '../SyncSchema.js';

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

describe('V1 dust wallet subscription', () => {
  describe('initial subscription cursor', () => {
    // Open one subscription against a recording stub and return the variables it was opened with. The
    // stub yields nothing, so the surrounding pipeline drains immediately.
    const cursorFor = async (
      state: CoreWallet,
      secretKey: DustSecretKey,
    ): Promise<DustLedgerEventsSubscriptionVariables | undefined> => {
      const recorded: { value?: DustLedgerEventsSubscriptionVariables } = {};
      const recordingFn = (variables: DustLedgerEventsSubscriptionVariables) => {
        recorded.value = variables;
        return Stream.empty as Stream.Stream<
          DustLedgerEventsSubscription,
          ClientError | ServerError,
          SubscriptionClient
        >;
      };

      const syncService = makeDefaultSyncService({
        indexerClientConnection: {
          indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
          indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
        },
        networkId,
      });

      await syncService
        .updates(state, secretKey)
        .pipe(
          Stream.runDrain,
          Effect.provideService(DustLedgerEvents.tag, recordingFn),
          Effect.scoped,
          Effect.runPromise,
        );

      return recorded.value;
    };

    it('omits the id (null) for a fresh wallet so the indexer streams from the very start', async () => {
      const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
      const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);

      const variables = await cursorFor(state, secretKey);

      expect(variables).toEqual({ id: null });
    });

    it('requests one below the applied index for a restored wallet so the boundary event is re-delivered', async () => {
      const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
      const state = CoreWallet.updateProgress(CoreWallet.initEmpty(dustParameters, secretKey, networkId), {
        appliedIndex: 5n,
      });

      const variables = await cursorFor(state, secretKey);

      expect(variables).toEqual({ id: 4 });
    });
  });
});

describe('V1 projections sync capability', () => {
  const projectionUpdate = (
    timestamp: Date,
    dustCommitmentMerkleTreeRoot = '00',
    dustGenerationMerkleTreeRoot = '00',
  ) =>
    StateUpdate({
      dustGenerations: {
        rawUpdates: [],
        newGenerations: [],
        generationDtimeUpdates: [],
      },
      newUtxos: DustUtxoMap.create([]),
      spentUtxos: DustUtxoMap.create([]),
      collapsedCommitments: [],
      latestBlock: {
        height: 1,
        hash: '00'.repeat(32),
        ledgerParameters: LedgerParameters.initialParameters(),
        timestamp,
        zswapEndIndex: 0,
        dustCommitmentEndIndex: 0,
        dustGenerationEndIndex: 0,
        dustCommitmentMerkleTreeRoot,
        dustGenerationMerkleTreeRoot,
      },
    });

  it('updates sync time on a fresh state without mutating the input state', () => {
    const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const serializedInput = state.state.serialize();
    const inputSyncTime = state.state.syncTime;
    const timestamp = new Date('2026-07-14T10:00:00.000Z');

    const [updatedState, result] = makeEventLessSyncCapability().applyUpdate(state, projectionUpdate(timestamp));

    expect(updatedState.state).not.toBe(state.state);
    expect(updatedState.state.syncTime).toEqual(timestamp);
    expect(updatedState.progress.highestIndex).toBe(1n);
    expect(result.changes).toEqual([]);
    expect(state.state.syncTime).toEqual(inputSyncTime);
    expect(state.state.serialize()).toEqual(serializedInput);
  });

  it('does not mutate or advance the input state when root validation fails', () => {
    const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const serializedInput = state.state.serialize();
    const inputSyncTime = state.state.syncTime;
    const inputProgress = state.progress;
    const timestamp = new Date('2026-07-14T10:00:00.000Z');

    expect(() =>
      makeEventLessSyncCapability().applyUpdate(state, projectionUpdate(timestamp, 'unexpected-commitment-root')),
    ).toThrow('Root hashes don`t match');

    expect(state.state.syncTime).toEqual(inputSyncTime);
    expect(state.state.serialize()).toEqual(serializedInput);
    expect(state.progress).toBe(inputProgress);
  });
});

describe('V1 projections nullifier subscription', () => {
  const ledgerParametersHex = Buffer.from(LedgerParameters.initialParameters().serialize()).toString('hex');

  const wireRecord = (nullifierLeBytes: string) => ({
    nullifierLeBytes,
    commitmentLeBytes: '00'.repeat(32),
    transactionId: 1,
    transactionHash: 'ff'.repeat(32),
    blockHeight: 10,
    blockHash: 'ee'.repeat(32),
    transaction: { __typename: 'SystemTransaction', block: { ledgerParameters: ledgerParametersHex } } as const,
  });

  it('keeps exact matches in fixed-width LE form, including nullifiers with a zero top byte', async () => {
    // topByteSet survives minimal-length (SCALE) encoding unchanged; topByteZero loses its final byte there,
    // while the indexer always reports the fixed 32-byte little-endian form.
    const topByteSet = (0x44n << 248n) | 0x12n;
    const topByteZero = (1n << 240n) | 0x0cn;
    const topByteSetHex = '12' + '00'.repeat(30) + '44';
    const topByteZeroHex = '0c' + '00'.repeat(29) + '01' + '00';
    const decoyHex = '12' + 'ff'.repeat(30) + '44'; // anonymity-set member sharing topByteSet's prefix

    const recorded: { value?: DustNullifierTransactionsSubscriptionVariables } = {};
    const stub = (variables: DustNullifierTransactionsSubscriptionVariables) => {
      recorded.value = variables;
      return Stream.fromIterable(
        [topByteSetHex, decoyHex, topByteZeroHex].map((hex) => ({ dustNullifierTransactions: wireRecord(hex) })),
      ) as Stream.Stream<WireDustNullifierTransactionsSubscription, ClientError | ServerError, SubscriptionClient>;
    };

    const service = makeIndexerSyncService({
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
        indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
      },
      networkId,
    });

    const records = await service
      .subscribeDustNullifierTransactions([topByteSet, topByteZero], 100, 2)
      .pipe(
        Stream.runCollect,
        Effect.map(Chunk.toArray),
        Effect.provideService(DustNullifierTransactions.tag, stub),
        Effect.provide(service.connectionLayer()),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(records.map((r) => r.nullifierLeBytes)).toEqual([topByteSetHex, topByteZeroHex]);
    expect(recorded.value?.fromBlock).toBe(0);
    expect(recorded.value?.toBlock).toBe(100);
    expect(recorded.value?.nullifierLeBytesPrefixes).toHaveLength(2);
    expect(recorded.value?.nullifierLeBytesPrefixes).toEqual(expect.arrayContaining(['12', '0c']));
  });
});

describe('V1 projections dust spend resolution', () => {
  const initialParameters = LedgerParameters.initialParameters();

  const spendEvent = (content: DustSpendProcessedEvent) => ({
    id: 1,
    maxId: 1,
    protocolVersion: 1,
    // Type cast required because: constructing a real ledger Event needs a serialized on-chain event; the code
    // under test only reads `raw.content`, so a structural fake keeps this test free of live infrastructure.
    raw: { content } as unknown as LedgerEvent,
  });

  const transactionWithSpends = (events: ReturnType<typeof spendEvent>[]): DustNullifierTransactionsSubscription => ({
    nullifierLeBytes: '00'.repeat(32),
    commitmentLeBytes: '00'.repeat(32),
    transactionId: 42,
    transactionHash: 'ee'.repeat(32),
    blockHeight: 10,
    blockHash: 'dd'.repeat(32),
    transaction: {
      __typename: 'RegularTransaction',
      block: { ledgerParameters: initialParameters },
      id: 42,
      hash: 'ee'.repeat(32),
      dustLedgerEvents: events,
      zswapLedgerEvents: [],
    },
  });

  const dustSpend = (nullifier: bigint): DustSpendProcessedEvent => ({
    tag: 'dustSpendProcessed',
    commitment: 1n,
    commitmentIndex: 9n,
    nullifier,
    vFee: 100n,
    declaredTime: new Date(2_000_000),
    blockTime: new Date(2_000_000),
  });

  it("skips dust spends whose nullifier is not this wallet's (multi-party transactions)", async () => {
    const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const foreignNullifier = 123456789n;

    const updates = await Effect.runPromise(
      createDustUtxoUpdates(
        state.state,
        [transactionWithSpends([spendEvent(dustSpend(foreignNullifier))])],
        secretKey,
        DustUtxoMap.create([]),
        new Map(),
        [],
      ),
    );

    expect(updates).toEqual([]);
  });

  it('resolves an owned spend into a spent update and its successor', async () => {
    const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const backingNight = 'ab'.repeat(32);
    const qdo = {
      initialValue: 1_000_000_000n,
      owner: secretKey.publicKey,
      nonce: dustFirstNonce(backingNight, secretKey.publicKey),
      seq: 0,
      ctime: new Date(1_000_000),
      backingNight,
      mtIndex: 4n,
    };
    const nullifier = dustNullifier(qdo, secretKey);
    const knownUtxos = DustUtxoMap.create([
      {
        dustNullifier: nullifier,
        genInfo: { value: 5_000_000_000n, owner: secretKey.publicKey, nonce: backingNight, dtime: undefined },
        generationMtIndex: 0,
        qdo,
        transactionId: 7,
        transactionHash: 'cd'.repeat(32),
      },
    ]);

    const updates = await Effect.runPromise(
      createDustUtxoUpdates(
        state.state,
        [transactionWithSpends([spendEvent(dustSpend(nullifier))])],
        secretKey,
        knownUtxos,
        new Map(),
        [],
      ),
    );

    expect(updates).toHaveLength(2);
    const [spent, successor] = updates;
    expect(spent.isSpent).toBe(true);
    expect(spent.dustNullifier).toBe(nullifier);
    expect(successor.isSpent).toBe(false);
    expect(successor.qdo.seq).toBe(1);
    expect(successor.qdo.mtIndex).toBe(9n);
  });
});

describe('nullifierPhaseProgress', () => {
  it('counts settled nullifiers as a full commitment-space scan', () => {
    expect(nullifierPhaseProgress(0n, 5, 0, 100)).toBe(500);
  });

  it('adds the merkle indices of still-live chains to the settled portion', () => {
    expect(nullifierPhaseProgress(100n, 5, 2, 100)).toBe(400);
  });

  it('never exceeds the phase ceiling', () => {
    expect(nullifierPhaseProgress(600n, 5, 2, 100)).toBe(500);
  });
});
