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
import { DustSecretKey, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { BlockHash, DustLedgerEvents } from '@midnightntwrk/wallet-sdk-indexer-client';
import type {
  BlockHashQuery,
  BlockHashQueryVariables,
  DustLedgerEventsSubscription,
  DustLedgerEventsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Cause, Effect, Exit, Option, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultSyncService, makeIndexerSyncService } from '../Sync.js';

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

describe('V1 blockData', () => {
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
