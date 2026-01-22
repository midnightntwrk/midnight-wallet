// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { type Error, FileSystem } from '@effect/platform';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { SerializedTransaction } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { HttpProverClient, ProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { type ClientError, type ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { TestContainers } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { Effect, Encoding, ParseResult, pipe, Random, Schema, Stream } from 'effect';
import { type Scope } from 'effect/Scope';
import { type StartedNetwork } from 'testcontainers';
import { normalizeTxs } from './normalize-txs.js';

export type FinalizedTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>;

const TxSchema = Schema.declare(
  (input: unknown): input is FinalizedTransaction => input instanceof ledger.Transaction,
).annotations({
  identifier: 'ledger.Transaction',
});
const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const TxFromUint8Array: Schema.Schema<FinalizedTransaction, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, TxSchema, {
    encode: (tx) => Effect.sync(() => tx.serialize()),
    decode: (bytes) =>
      Effect.try({
        try: () => ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes),

        catch: (err) => new ParseResult.Unexpected(err, 'Could not deserialize transaction'),
      }),
  }),
);

const HexedTx: Schema.Schema<FinalizedTransaction, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(TxFromUint8Array),
);
type TxSchema = Schema.Schema.Type<typeof HexedTx>;

const TestTransactionsSchema = Schema.Struct({
  initial_tx: HexedTx,
  unbalanced_tx: HexedTx,
  batches: Schema.Array(HexedTx),
});
export type TestTransactions = Schema.Schema.Type<typeof TestTransactionsSchema>;

export const load: (
  file: string,
) => Effect.Effect<TestTransactions, ParseResult.ParseError | Error.PlatformError, FileSystem.FileSystem> = (file) =>
  pipe(
    FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.readFileString(file))),
    Effect.map((str) => JSON.parse(str) as unknown),
    Effect.andThen(Schema.decodeUnknown(TestTransactionsSchema, { errors: 'all' })),
    Effect.cached,
    Effect.flatten,
  );

export const streamAllValid = (txs: TestTransactions): Stream.Stream<FinalizedTransaction> => {
  const initial = Stream.succeed(txs.initial_tx);
  const batches = Stream.fromIterable(txs.batches);

  return Stream.concat(initial, batches);
};

export const genUnbalancedTx = (): Effect.Effect<
  SerializedTransaction,
  ClientError | ServerError,
  ProverClient.ProverClient
> =>
  Effect.Do.pipe(
    Effect.bind('value', () => Random.nextIntBetween(1, 100_000_000).pipe(Effect.map((nr) => BigInt(nr)))),
    Effect.bind('shieldedTokenType', () =>
      Effect.succeed(ledger.shieldedToken() as unknown as { type: 'shielded'; raw: string }),
    ),
    Effect.let('unprovenTx', ({ value, shieldedTokenType }) => {
      const recipient = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(0));
      const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, value);
      const unprovenOutput = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
      const unprovenOffer = ledger.ZswapOffer.fromOutput(unprovenOutput, shieldedTokenType.raw, value);
      return ledger.Transaction.fromParts('undeployed', unprovenOffer);
    }),
    Effect.flatMap(({ unprovenTx }) =>
      Effect.gen(function* () {
        const proverClient = yield* ProverClient.ProverClient;
        const provedTx = yield* proverClient.proveTransaction(unprovenTx, ledger.CostModel.initialCostModel());

        return SerializedTransaction(provedTx.bind().serialize());
      }),
    ),
  );

const normalizeAndSaveUnbalancedTx = (txsPath: string, tx: Uint8Array) => {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const outputFileData: any = yield* fs.readFileString(txsPath, 'utf8').pipe(Effect.map((str) => normalizeTxs(str)));

    const augmentedOutput = {
      ...outputFileData,
      unbalanced_tx: Encoding.encodeHex(tx),
    };
    yield* fs.writeFileString(txsPath, JSON.stringify(augmentedOutput));
  });
  /* eslint-enable */
};

const generateUnbalancedTransaction = (proofServerUrl: string) => {
  // Originally written with `Effect.gen`, but rewritten to Do notation to debug some typing issue
  // It seems to be a somewhat regular issue
  return Effect.Do.pipe(
    Effect.bind('tx', () => genUnbalancedTx()),
    Effect.map(({ tx }) => tx),
    Effect.provide(
      HttpProverClient.layer({
        url: new URL(proofServerUrl),
      }),
    ),
  );
};

export const generateTestTransactions = (
  nodeUrl: string,
  proofServerUrl: string,
  network: StartedNetwork,
  outputPath: string,
  fileName: string,
): Effect.Effect<void, Error | Error.PlatformError, FileSystem.FileSystem | Scope> =>
  Effect.gen(function* () {
    const [, unbalancedTx] = yield* Effect.all([
      TestContainers.runTxGenerator(
        {
          nodeUrl: nodeUrl,
          destPath: outputPath,
          fileName: fileName,
          txsPerBatch: 1,
          batches: 1,
        },
        (c) => c.withNetwork(network),
      ),
      generateUnbalancedTransaction(proofServerUrl),
    ]);

    yield* normalizeAndSaveUnbalancedTx(`${outputPath}/${fileName}`, unbalancedTx);
  });
