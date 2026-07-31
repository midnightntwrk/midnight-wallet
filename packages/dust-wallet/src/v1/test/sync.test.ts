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
  type DustGenerationTreeInsertionPath,
  DustLocalState,
  DustSecretKey,
  dustFirstNonce,
  dustNullifier,
  type Event as LedgerEvent,
  LedgerParameters,
} from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { BlockHash, DustLedgerEvents, DustNullifierTransactions } from '@midnightntwrk/wallet-sdk-indexer-client';
import type {
  BlockHashQuery,
  BlockHashQueryVariables,
  DustLedgerEventsSubscription,
  DustLedgerEventsSubscriptionVariables,
  DustNullifierTransactionsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { QueryClient, SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Cause, Chunk, Effect, Exit, HashMap, Option, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet, PublicKey } from '../CoreWallet.js';
import {
  createDustUtxoUpdates,
  doEventlessSync,
  type IndexerSyncService,
  makeDefaultSyncService,
  makeEventLessSyncCapability,
  makeIndexerSyncService,
  nullifierPhaseProgress,
  resolveNullifierSpends,
} from '../Sync.js';
import {
  type BlockData,
  type DustGenerationsSubscription,
  DustGenerationsSyncUpdate,
  type DustNullifierTransactionsSubscription,
  type DustProjectionsUpdate,
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
      );
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

  it("drops a foreign malformed transaction without letting it break this wallet's sync", async () => {
    const walletNullifier = 0x12n;
    const walletNullifierHex = '12' + '00'.repeat(31);
    const foreignNullifierHex = '12' + 'ff'.repeat(31);
    const malformedForeignRecord = {
      ...wireRecord(foreignNullifierHex),
      transaction: { __typename: 'SystemTransaction', block: { ledgerParameters: 'not-hex' } } as const,
    };
    const stub = (_variables: DustNullifierTransactionsSubscriptionVariables) =>
      Stream.fromIterable([
        { dustNullifierTransactions: wireRecord(walletNullifierHex) },
        { dustNullifierTransactions: malformedForeignRecord },
      ]);

    const service = makeIndexerSyncService({
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
        indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
      },
      networkId,
    });

    const records = await service
      .subscribeDustNullifierTransactions([walletNullifier], 100, 1)
      .pipe(
        Stream.runCollect,
        Effect.map(Chunk.toArray),
        Effect.provideService(DustNullifierTransactions.tag, stub),
        Effect.provide(service.connectionLayer()),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(records.map((record) => record.nullifierLeBytes)).toEqual([walletNullifierHex]);
  });
});

describe('V1 projections blockData', () => {
  it('fails with a typed WalletError (not a defect) when the indexer returns no block', async () => {
    // Cold indexer / reorg: the indexer resolves the query but with `block: null`. This is an EXPECTED
    // condition and must surface as a typed FAILURE in the error channel, never as a defect (die) that
    // bypasses catchAll and crashes the wallet. A synchronous `throw` inside the flatMap callback is
    // captured by Effect as a defect; the fix must place the error in the typed channel via Effect.fail.
    const noBlock: BlockHashQuery = { block: null };
    // Hand-written stub (no vi.fn / vi.mock): the query tag is (variables) => Effect<BlockHashQuery>.
    const stub = (_variables: BlockHashQueryVariables): Effect.Effect<BlockHashQuery> => Effect.succeed(noBlock);

    const service = makeIndexerSyncService({
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
        indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
      },
      networkId,
    });

    const exit = await service
      .blockData(undefined)
      .pipe(
        Effect.provideService(BlockHash.tag, stub),
        Effect.provide(service.queryClient()),
        Effect.scoped,
        Effect.runPromiseExit,
      );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Must be a typed failure, NOT a defect: with the current synchronous `throw` this is a die and both
      // assertions below fail (RED). After the throw -> Effect.fail fix it is a typed failure (GREEN).
      expect(Cause.isDie(exit.cause)).toBe(false);
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe('Wallet.Other');
        expect(failure.value.message).toBe('Unable to fetch block data');
        expect(failure.value.cause).toBeUndefined();
      }
    }
  });

  it('wraps a transport failure as an unexpected WalletError with the original cause', async () => {
    const transportError = new ServerError({ message: 'indexer unavailable' });
    const stub = (_variables: BlockHashQueryVariables): Effect.Effect<BlockHashQuery, ServerError> =>
      Effect.fail(transportError);

    const service = makeIndexerSyncService({
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
        indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
      },
      networkId,
    });

    const exit = await service
      .blockData(undefined)
      .pipe(
        Effect.provideService(BlockHash.tag, stub),
        Effect.provide(service.queryClient()),
        Effect.scoped,
        Effect.runPromiseExit,
      );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe('Wallet.Other');
        expect(failure.value.message).toBe('Encountered unexpected error: indexer unavailable');
        expect(failure.value.cause).toBe(transportError);
      }
    }
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

describe('V1 projections nullifier resolution loop', () => {
  // The wallet re-queries the indexer with the *still-live* nullifiers until a round comes back empty. Every other
  // test in this file feeds the loop exactly one round, so nothing pins the loop itself. A 50-deep chain — a very
  // active user making repeated Dust spends from a single Night UTXO — is what catches the loop re-querying
  // settled nullifiers, running unbounded, or stopping at the first successor.
  const CHAIN_DEPTH = 50;
  const initialParameters = LedgerParameters.initialParameters();
  const backingNight = 'ab'.repeat(32);
  const GENESIS_MT_INDEX = 4n;
  // Successor commitment indices start above GENESIS_MT_INDEX so every qdo in the chain is distinct, which is what
  // makes each round's nullifier distinct.
  const firstSuccessorIndex = 10n;

  const latestBlock: BlockData = {
    height: 100,
    hash: 'ab'.repeat(32),
    ledgerParameters: initialParameters,
    timestamp: new Date(3_000_000),
    zswapEndIndex: 0,
    dustCommitmentEndIndex: 4096,
    dustGenerationEndIndex: 8,
    dustCommitmentMerkleTreeRoot: '',
    dustGenerationMerkleTreeRoot: '',
  };

  const notCalled = (name: string) => (): never => {
    throw new Error(`${name} must not be called during nullifier resolution`);
  };

  const spendTransaction = (nullifier: bigint, commitmentIndex: bigint): DustNullifierTransactionsSubscription => ({
    nullifierLeBytes: '00'.repeat(32),
    commitmentLeBytes: '00'.repeat(32),
    transactionId: Number(commitmentIndex),
    transactionHash: 'ee'.repeat(32),
    blockHeight: 10,
    blockHash: 'dd'.repeat(32),
    transaction: {
      __typename: 'RegularTransaction',
      block: { ledgerParameters: initialParameters },
      id: Number(commitmentIndex),
      hash: 'ee'.repeat(32),
      dustLedgerEvents: [
        {
          id: 1,
          maxId: 1,
          protocolVersion: 1,
          // Type cast required because: constructing a real ledger Event needs a serialized on-chain event; the
          // code under test only reads `raw.content`, so a structural fake keeps this test free of live infra.
          raw: {
            content: {
              tag: 'dustSpendProcessed',
              commitment: commitmentIndex,
              commitmentIndex,
              nullifier,
              vFee: 100n,
              declaredTime: new Date(2_000_000),
              blockTime: new Date(2_000_000),
            } satisfies DustSpendProcessedEvent,
          } as unknown as LedgerEvent,
        },
      ],
      zswapLedgerEvents: [],
    },
  });

  /**
   * Drives the real loop over a `depth`-long spend chain rooted in a single Night-backed generation. The recording stub
   * answers each round by spending exactly the nullifiers it was asked for, then reports the chain exhausted; the round
   * number is `queried.length`, so no mutable counter is needed.
   */
  const runChain = async (depth: number) => {
    const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const genesisQdo = {
      initialValue: 1_000_000_000n,
      owner: secretKey.publicKey,
      nonce: dustFirstNonce(backingNight, secretKey.publicKey),
      seq: 0,
      ctime: new Date(1_000_000),
      backingNight,
      mtIndex: GENESIS_MT_INDEX,
    };
    const genesisNullifier = dustNullifier(genesisQdo, secretKey);
    const initialUtxos = DustUtxoMap.create([
      {
        dustNullifier: genesisNullifier,
        genInfo: { value: 5_000_000_000n, owner: secretKey.publicKey, nonce: backingNight, dtime: undefined },
        generationMtIndex: 0,
        qdo: genesisQdo,
        transactionId: 7,
        transactionHash: 'cd'.repeat(32),
      },
    ]);

    const queried: bigint[][] = [];
    const emitted: DustProjectionsUpdate[] = [];

    const indexerSyncService: IndexerSyncService = {
      subscribeDustNullifierTransactions: (dustNullifiers) => {
        queried.push([...dustNullifiers]);
        return queried.length <= depth
          ? Stream.fromIterable(
              dustNullifiers.map((n) => spendTransaction(n, firstSuccessorIndex + BigInt(queried.length - 1))),
            )
          : Stream.empty;
      },
      // Nothing else belongs in this phase; a call here fails loudly instead of silently widening the test.
      connectionLayer: notCalled('connectionLayer'),
      subscribeWallet: notCalled('subscribeWallet'),
      subscribeDustGenerations: notCalled('subscribeDustGenerations'),
      dustCommitmentMerkleTreeUpdate: notCalled('dustCommitmentMerkleTreeUpdate'),
      queryClient: notCalled('queryClient'),
      blockData: notCalled('blockData'),
    };

    const unusedSubscriptionClient: SubscriptionClient.Service = {
      subscribe: notCalled('SubscriptionClient.subscribe'),
      subscribeWithBackpressure: notCalled('SubscriptionClient.subscribeWithBackpressure'),
    };

    const noGenerationUpdates: DustGenerationsSyncUpdate = {
      rawUpdates: [],
      newGenerations: [],
      generationDtimeUpdates: [],
    };

    const { nextUtxos, nextSpentUtxos } = await resolveNullifierSpends(
      [genesisNullifier],
      initialUtxos,
      new Map(),
      state.state,
      secretKey,
      latestBlock,
      noGenerationUpdates,
      indexerSyncService,
      7,
      {
        single: (update) => {
          emitted.push(update);
          return Promise.resolve();
        },
      },
    ).pipe(Effect.provideService(SubscriptionClient, unusedSubscriptionClient), Effect.scoped, Effect.runPromise);

    return { genesisNullifier, queried, emitted, nextUtxos, nextSpentUtxos };
  };

  it('re-queries only the still-live nullifier each round and terminates when the chain runs out', async () => {
    const { genesisNullifier, queried } = await runChain(CHAIN_DEPTH);

    // CHAIN_DEPTH productive rounds, plus the one round that comes back empty and ends the loop.
    expect(queried).toHaveLength(CHAIN_DEPTH + 1);
    expect(queried[0]).toEqual([genesisNullifier]);
    // One nullifier per round: a settled nullifier is never re-sent, so the query never grows with chain depth.
    expect(queried.map((round) => round.length)).toEqual(new Array(CHAIN_DEPTH + 1).fill(1));
    // ...and every round asks about a nullifier it has never asked about before.
    expect(new Set(queried.flat()).size).toBe(CHAIN_DEPTH + 1);
  });

  it('records every spend and leaves exactly one live UTXO at the chain tip', async () => {
    const { nextUtxos, nextSpentUtxos } = await runChain(CHAIN_DEPTH);

    expect(HashMap.size(nextSpentUtxos)).toBe(CHAIN_DEPTH);
    // Spent entries are accumulated alongside the live ones here; pruning is the capability's job, not this loop's.
    expect(HashMap.size(nextUtxos)).toBe(CHAIN_DEPTH + 1);

    const live = Array.from(HashMap.entries(nextUtxos)).filter(
      ([nullifier]) => !HashMap.has(nextSpentUtxos, nullifier),
    );
    expect(live).toHaveLength(1);
    expect(live[0][1].qdo.seq).toBe(CHAIN_DEPTH);
    expect(live[0][1].qdo.mtIndex).toBe(firstSuccessorIndex + BigInt(CHAIN_DEPTH - 1));
  });

  it('reports progress once per productive round, never going backwards', async () => {
    const { emitted } = await runChain(CHAIN_DEPTH);

    // The exhausted round finds no fresh UTXO, so it reports nothing.
    expect(emitted).toHaveLength(CHAIN_DEPTH);
    const appliedIndexes = emitted.flatMap((update) =>
      update._tag === 'ProgressUpdate' && update.appliedIndex !== undefined ? [update.appliedIndex] : [],
    );
    // Every emission is a ProgressUpdate carrying an appliedIndex — nothing else is reported in this phase.
    expect(appliedIndexes).toHaveLength(CHAIN_DEPTH);
    expect(appliedIndexes).toEqual([...appliedIndexes].sort((a, b) => a - b));
    expect(new Set(appliedIndexes).size).toBe(CHAIN_DEPTH);
  });
});

describe('V1 projections cNight generation discovery', () => {
  // A Dust wallet backed only by cNight, coming from multiple registrations and UTXOs, is the shape mainnet
  // actually has. In the projections model that case lands entirely on `DustGenerationsSyncUpdate.create`, the
  // counterpart of the spec's `apply_system_transaction` (docs/spec/Specification.md): a cNight registration
  // becomes an own generation plus the first Dust output of its chain, and a deregistration carries the dtime for
  // the generation it backs. Nothing exercised this function before, so registration fan-out was fully unpinned.
  type GenerationItem = Extract<DustGenerationsSubscription, { __typename: 'DustGenerationsItem' }>;
  type DtimeUpdateItem = Extract<DustGenerationsSubscription, { __typename: 'DustGenerationDtimeUpdateItem' }>;

  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const publicKey = PublicKey.fromSecretKey(secretKey);
  const ownAddress = new DustAddress(publicKey.publicKey).hexString;
  const foreignAddress = new DustAddress(
    DustSecretKey.fromSeed(Buffer.from(seedHex.slice(0, -1) + '2', 'hex')).publicKey,
  ).hexString;

  const NIGHT_A = '11'.repeat(32);
  const NIGHT_B = '22'.repeat(32);
  const NIGHT_C = '33'.repeat(32);

  // One cNight registration as the indexer projects it. A distinct backingNight per registration is what makes each
  // generation — and therefore each first-in-chain nullifier — distinct.
  const registration = (
    generationMtIndex: number,
    backingNight: string,
    overrides: Partial<GenerationItem> = {},
  ): GenerationItem => ({
    __typename: 'DustGenerationsItem',
    commitmentMtIndex: 1000 + generationMtIndex,
    generationMtIndex,
    owner: ownAddress,
    value: '250',
    initialValue: '5000',
    backingNight,
    ctime: new Date(1_700_000_000_000),
    transactionId: 40 + generationMtIndex,
    transactionHash: 'aa'.repeat(32),
    collapsedMerkleTree: null,
    ...overrides,
  });

  const dtimeUpdate = (generationMtIndex: number, nightUtxoHash: string, newDtime: Date): DtimeUpdateItem => ({
    __typename: 'DustGenerationDtimeUpdateItem',
    generationMtIndex,
    nightUtxoHash,
    newDtime,
    // Type cast required because: a real DustGenerationTreeInsertionPath can only be built from a populated
    // DustGenerationState — the ledger throws "invalid index into sparse merkle tree" on an empty one — which needs
    // live ledger state this unit test deliberately avoids. `create` treats the field as an opaque passthrough, so a
    // sentinel object is enough to prove it is handed through unchanged.
    treeInsertionPath: { sentinel: generationMtIndex } as unknown as DustGenerationTreeInsertionPath,
  });

  // Deliberately out of generation-index order: the indexer gives no ordering guarantee.
  const threeRegistrations = [registration(9, NIGHT_C), registration(3, NIGHT_A), registration(5, NIGHT_B)];
  // A fresh wallet's generating tree is empty, so firstFree - 1 is -1 and every index is new.
  const FRESH_WALLET = -1n;

  it('turns each cNight registration into the first Dust output of its own chain, ordered by generation index', () => {
    const { newGenerations } = DustGenerationsSyncUpdate.create(threeRegistrations, secretKey, publicKey, FRESH_WALLET);

    expect(newGenerations.map((g) => g.generationMtIndex)).toEqual([3, 5, 9]);
    expect(newGenerations.map((g) => g.qdo.backingNight)).toEqual([NIGHT_A, NIGHT_B, NIGHT_C]);
    // Spec `apply_system_transaction`: a registration yields the *first* output of the chain — seq 0, nonce derived
    // from the backing Night UTxO.
    expect(newGenerations.map((g) => g.qdo.seq)).toEqual([0, 0, 0]);
    // commitmentMtIndex is where that first Dust output sits in the commitments tree.
    expect(newGenerations.map((g) => g.qdo.mtIndex)).toEqual([1003n, 1005n, 1009n]);
    newGenerations.forEach((g) => {
      expect(g.qdo.nonce).toEqual(dustFirstNonce(g.qdo.backingNight, publicKey.publicKey));
      expect(g.qdo.owner).toEqual(publicKey.publicKey);
      expect(g.qdo.initialValue).toBe(5000n);
      expect(g.genInfo.value).toBe(250n);
      expect(g.genInfo.nonce).toBe(g.qdo.backingNight);
      // A live registration has no dtime — the backing cNight has not been deregistered.
      expect(g.genInfo.dtime).toBeUndefined();
    });
  });

  it('derives a distinct nullifier per registration so one query round covers every chain', () => {
    const { newGenerations } = DustGenerationsSyncUpdate.create(threeRegistrations, secretKey, publicKey, FRESH_WALLET);

    newGenerations.forEach((g) => {
      expect(g.dustNullifier).toEqual(dustNullifier(g.qdo, secretKey));
    });
    // Multiple registrations are the mainnet shape. If they collapsed onto one nullifier the resolution phase would
    // silently follow a single chain and under-report the wallet's Dust.
    expect(new Set(newGenerations.map((g) => g.dustNullifier)).size).toBe(3);
  });

  it("ignores registrations belonging to another wallet's Dust address", () => {
    const updates = [...threeRegistrations, registration(11, '44'.repeat(32), { owner: foreignAddress })];

    const { newGenerations } = DustGenerationsSyncUpdate.create(updates, secretKey, publicKey, FRESH_WALLET);

    expect(newGenerations.map((g) => g.generationMtIndex)).toEqual([3, 5, 9]);
  });

  it('skips registrations already covered by the restored generation tree', () => {
    // firstFree - 1 == 5 means generation 5 is already in the local tree; only strictly greater indices are new.
    const { newGenerations } = DustGenerationsSyncUpdate.create(threeRegistrations, secretKey, publicKey, 5n);

    expect(newGenerations.map((g) => g.generationMtIndex)).toEqual([9]);
  });

  it('extracts deregistration dtime updates in index order without mistaking them for new generations', () => {
    const later = dtimeUpdate(9, NIGHT_C, new Date(1_800_000_000_000));
    const earlier = dtimeUpdate(3, NIGHT_A, new Date(1_750_000_000_000));

    const { newGenerations, generationDtimeUpdates } = DustGenerationsSyncUpdate.create(
      [...threeRegistrations, later, earlier],
      secretKey,
      publicKey,
      FRESH_WALLET,
    );

    // Deregistrations must not create generations...
    expect(newGenerations.map((g) => g.generationMtIndex)).toEqual([3, 5, 9]);
    // ...they are surfaced separately and sorted, so the wallet can stamp dtime on the generation each one backs.
    expect(generationDtimeUpdates.map((u) => u.generationMtIndex)).toEqual([3, 9]);
    expect(generationDtimeUpdates.map((u) => u.nightUtxoHash)).toEqual([NIGHT_A, NIGHT_C]);
    expect(generationDtimeUpdates.map((u) => u.newDtime)).toEqual([
      new Date(1_750_000_000_000),
      new Date(1_800_000_000_000),
    ]);
    // The GraphQL discriminator is stripped, and the insertion path is handed through untouched.
    expect(generationDtimeUpdates.every((u) => !('__typename' in u))).toBe(true);
    expect(generationDtimeUpdates[0].treeInsertionPath).toBe(earlier.treeInsertionPath);
  });

  it('ignores progress items while preserving every raw update for the tree rebuild', () => {
    const progress: DustGenerationsSubscription = {
      __typename: 'DustGenerationsProgress',
      highestIndex: 9,
      collapsedMerkleTree: null,
    };
    const updates = [...threeRegistrations, progress];

    const result = DustGenerationsSyncUpdate.create(updates, secretKey, publicKey, FRESH_WALLET);

    expect(result.newGenerations).toHaveLength(3);
    expect(result.generationDtimeUpdates).toHaveLength(0);
    // The capability replays rawUpdates to rebuild the generations Merkle tree, so nothing may be dropped here.
    expect(result.rawUpdates).toEqual(updates);
  });
});

describe('V1 projections progress monotonicity', () => {
  // Sync progress is reported as a single figure that advances as the sync proceeds; a progress figure that goes
  // *backwards* is a defect regardless of the weighting chosen. This drives the real
  // `doEventlessSync` (previously untested end-to-end) with a wallet that already holds a Dust UTxO — i.e. the
  // restored case, which is the only shape where the two `appliedIndex` formulas disagree.
  //
  //   emission 1 (Sync.ts:376) = lastSyncedGenerationIndex + lastSyncedCommitmentIndex
  //                              + nullifiers.size * maxCommitmentTreeIndex
  //   emission 2 (Sync.ts:406) = maxGeneratingTreeIndex
  //
  // Emission 2 drops both the commitment term and the nullifier term. A fresh wallet hides this (its emission 1 is
  // negative), which is why every existing test misses it.
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const backingNight = 'ab'.repeat(32);
  // The local commitment tree is already filled to this height, and the block reports the same end index. That
  // equality is deliberate: it makes the commitment phase short-circuit without a single indexer call, so the sync
  // runs to completion. Emissions cannot be observed past a producer failure — they are buffered, and the failure
  // discards the buffer — so the run has to succeed for the reported sequence to be visible at all.
  const COMMITMENT_END_INDEX = 8;
  const GENERATION_END_INDEX = 4;

  const latestBlock: BlockData = {
    height: 100,
    hash: 'ab'.repeat(32),
    ledgerParameters: LedgerParameters.initialParameters(),
    timestamp: new Date(3_000_000),
    zswapEndIndex: 0,
    dustCommitmentEndIndex: COMMITMENT_END_INDEX,
    dustGenerationEndIndex: GENERATION_END_INDEX,
    dustCommitmentMerkleTreeRoot: '',
    dustGenerationMerkleTreeRoot: '',
  };

  const notCalled = (name: string) => (): never => {
    throw new Error(`${name} must not be called in this scenario`);
  };

  const qdoFor = (night: string, mtIndex: bigint) => ({
    initialValue: 1_000_000_000n,
    owner: secretKey.publicKey,
    nonce: dustFirstNonce(night, secretKey.publicKey),
    seq: 0,
    ctime: new Date(1_000_000),
    backingNight: night,
    mtIndex,
  });

  /**
   * A wallet as it looks after a restore: its commitment tree is already populated (with other people's commitments,
   * inserted linearly as the ledger requires) and it tracks one Dust UTXO of its own, so `state.nullifiers` is
   * non-empty. Both are what make the two progress formulas disagree.
   */
  const restoredWallet = () => {
    const withCommitments = Array.from({ length: COMMITMENT_END_INDEX }).reduce<DustLocalState>(
      (acc, _, i) =>
        acc.insertCommitment(BigInt(i), qdoFor(i.toString(16).padStart(2, '0').repeat(32), BigInt(i)), false),
      new DustLocalState(dustParameters),
    );
    const own = qdoFor(backingNight, 4n);
    return CoreWallet.init(withCommitments.addUtxo(dustNullifier(own, secretKey), own), secretKey, networkId);
  };

  /** Runs one full projections sync against the stubs and returns every appliedIndex it reported, in order. */
  const reportedAppliedIndexes = async (): Promise<number[]> => {
    const state = restoredWallet();

    const indexerSyncService: IndexerSyncService = {
      blockData: () => Effect.succeed(latestBlock),
      // No new generations and no spends, so the sync walks straight through to the end.
      subscribeDustGenerations: () => Stream.empty,
      subscribeDustNullifierTransactions: () => Stream.empty,
      // Never reached: the commitment phase short-circuits because the local tree is already filled to the
      // block's end index. A call here means that short-circuit broke and this is no longer the scenario above.
      dustCommitmentMerkleTreeUpdate: notCalled('dustCommitmentMerkleTreeUpdate'),
      connectionLayer: notCalled('connectionLayer'),
      subscribeWallet: notCalled('subscribeWallet'),
      queryClient: notCalled('queryClient'),
    };

    return doEventlessSync(state, secretKey, 7, indexerSyncService).pipe(
      Stream.filterMap((update) =>
        update._tag === 'ProgressUpdate' && update.appliedIndex !== undefined
          ? Option.some(update.appliedIndex)
          : Option.none(),
      ),
      Stream.runCollect,
      Effect.map(Chunk.toArray),
      Effect.provideService(QueryClient, { query: notCalled('QueryClient.query') }),
      Effect.provideService(SubscriptionClient, {
        subscribe: notCalled('SubscriptionClient.subscribe'),
        subscribeWithBackpressure: notCalled('SubscriptionClient.subscribeWithBackpressure'),
      }),
      Effect.scoped,
      Effect.runPromise,
    );
  };

  it('reports progress four times on a wallet that already tracks a Dust UTXO', async () => {
    const state = restoredWallet();
    expect(state.state.nullifiers.size).toBe(1);
    expect(state.state.commitmentTreeFirstFree).toBe(BigInt(COMMITMENT_END_INDEX));

    // This pins the scenario itself. The known-defect test below is expected to throw, and *any* throw satisfies
    // it — including the sync quietly reporting nothing at all — so the report count is asserted here instead,
    // where a broken harness still surfaces as a real failure.
    expect(await reportedAppliedIndexes()).toHaveLength(4);
  });

  // KNOWN DEFECT, deliberately left failing. `.fails` inverts the expectation so runs stay green while the defect
  // is outstanding, without weakening the assertion below.
  //
  // The four reports are computed on three different bases, and the first one over-counts: it credits the
  // already-synced commitment tree, while the two that follow do not count the commitment tree at all. So the
  // opening report can exceed a later one, and progress visibly jumps backwards. Note this cannot be repaired by
  // adjusting the second report alone — report 1 already exceeds report 3 — so all four need a common basis.
  //
  // Fixing it makes this test *pass*, which makes `.fails` report a failure. That is the intended signal to delete
  // `.fails` and keep it as an ordinary regression guard.
  it.fails('never reports an appliedIndex lower than one it already reported', async () => {
    const appliedIndexes = await reportedAppliedIndexes();

    const regressions = appliedIndexes.flatMap((value, i) =>
      i > 0 && value < appliedIndexes[i - 1] ? [{ step: i, from: appliedIndexes[i - 1], to: value }] : [],
    );
    expect(regressions).toEqual([]);
  });
});
