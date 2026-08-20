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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { BlockHash } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Effect, Either, pipe } from 'effect';
import { LedgerParametersCodec } from '../codecs/index.js';
import { getLastBlock, type Simulator } from '../simulation/index.js';
import type { BlockData } from './validationService.js';

export type BlockDataFetcher = () => Promise<BlockData>;

/**
 * The ledger parameters codecs validation reads blocks with, unless it is told otherwise.
 *
 * @remarks
 *   Open-ended from the minimum supported version, because well-formedness is checked against one ledger version's
 *   `LedgerState`: this registry is the seam where a second ledger version's codec is registered when validation
 *   itself learns to speak two.
 */
export const defaultLedgerParametersCodecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters> =
  Either.getOrThrow(
    LedgerParametersCodec.makeCodecs([
      {
        sinceVersion: ProtocolVersion.MinSupportedVersion,
        codec: LedgerParametersCodec.fromDeserializer((bytes: Uint8Array) => LedgerParameters.deserialize(bytes)),
      },
    ]),
  );

export type DefaultBlockDataFetcherConfiguration = {
  indexerClientConnection: {
    indexerHttpUrl: string;
  };
  /** The ledger parameters codecs blocks are read with; defaults to {@link defaultLedgerParametersCodecs}. */
  ledgerParametersCodecs?: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>;
};

/** The block as the indexer serves it: parameters still hex, and the version that says how to read them. */
export type WireBlock = Readonly<{
  hash: string;
  height: number;
  protocolVersion: number;
  ledgerParameters: string;
  timestamp: number;
}>;

/**
 * Reads an indexer block into {@link BlockData}, decoding its ledger parameters with whichever registered codec claims
 * the protocol version the block was reported under.
 *
 * @param codecs The ledger parameters codecs the caller is willing to read with.
 * @param block The block as the indexer served it.
 * @returns The block data, or the typed reason its parameters could not be read.
 */
export const blockDataFrom = (
  codecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>,
  block: WireBlock,
): Either.Either<BlockData, LedgerParametersCodec.LedgerParametersCodecError> =>
  pipe(
    LedgerParametersCodec.decode(
      codecs,
      ProtocolVersion.ProtocolVersion(BigInt(block.protocolVersion)),
      block.ledgerParameters,
    ),
    Either.map((ledgerParameters) => ({
      hash: block.hash,
      height: block.height,
      protocolVersion: block.protocolVersion,
      ledgerParameters,
      timestamp: new Date(block.timestamp),
    })),
  );

/**
 * Builds a `BlockDataFetcher` that queries the indexer over HTTP for the latest block.
 *
 * Each call opens a short-lived query client, runs the `BlockHash` query, and closes the client.
 */
export const makeDefaultBlockDataFetcher = (config: DefaultBlockDataFetcherConfiguration): BlockDataFetcher => {
  const url = config.indexerClientConnection.indexerHttpUrl;
  const codecs = config.ledgerParametersCodecs ?? defaultLedgerParametersCodecs;
  return () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* BlockHash;
        const result = yield* query({ offset: null });
        const block = result.block;
        if (!block) throw new Error('Unable to fetch latest block from indexer.');
        return yield* blockDataFrom(codecs, block);
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
          protocolVersion: Number(lastBlock.protocolVersion),
          ledgerParameters: state.ledger.parameters,
          timestamp: state.currentTime,
        };
      }),
    );
};
