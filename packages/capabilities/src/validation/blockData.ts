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
import { LedgerParameters } from '@midnightntwrk/ledger-v9';
import { BlockHash } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Buffer } from 'buffer';
import { Effect } from 'effect';
import { getLastBlock, type Simulator } from '../simulation/index.js';
import type { BlockData } from './validationService.js';

export type BlockDataFetcher = () => Promise<BlockData>;

export type DefaultBlockDataFetcherConfiguration = {
  indexerClientConnection: {
    indexerHttpUrl: string;
  };
};

/**
 * Builds a `BlockDataFetcher` that queries the indexer over HTTP for the latest block.
 *
 * Each call opens a short-lived query client, runs the `BlockHash` query, and closes the client.
 */
export const makeDefaultBlockDataFetcher = (config: DefaultBlockDataFetcherConfiguration): BlockDataFetcher => {
  const url = config.indexerClientConnection.indexerHttpUrl;
  return () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* BlockHash;
        const result = yield* query({ offset: null });
        const block = result.block;
        if (!block) throw new Error('Unable to fetch latest block from indexer.');
        return {
          hash: block.hash,
          height: block.height,
          ledgerParameters: LedgerParameters.deserialize(Buffer.from(block.ledgerParameters, 'hex')),
          timestamp: new Date(block.timestamp),
        };
      }).pipe(Effect.provide(HttpQueryClient.layer({ url })), Effect.scoped),
    );
};

/**
 * Builds a `BlockDataFetcher` backed by a {@link Simulator}. Returns the simulator's latest block, using its
 * `currentTime` for the timestamp (so fast-forwarded simulator clocks are respected).
 */
export const makeSimulatorBlockDataFetcher = (simulator: Simulator): BlockDataFetcher => {
  return () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const state = yield* simulator.getLatestState();
        const lastBlock = getLastBlock(state);
        if (!lastBlock) throw new Error('Simulator has not produced any block yet.');
        return {
          hash: lastBlock.hash,
          height: Number(lastBlock.number),
          ledgerParameters: state.ledger.parameters,
          timestamp: state.currentTime,
        };
      }),
    );
};
