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
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { TransactionHistoryDetail, type TransactionHistoryDetailQuery } from '@midnightntwrk/wallet-sdk-indexer-client';
import { Cause, Duration, Effect, Exit, Fiber, Option, Ref, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  makeDefaultTransactionHistoryService,
  DustTransactionHistoryEntrySchema,
  type DefaultTransactionHistoryConfiguration,
} from '../TransactionHistory.js';
import { TransactionHistoryError } from '../WalletError.js';

const hash = 'c0a46613b653a5c6f14a369f3799cdb122a57c3ec83a9f1358717fa8a2221204';

const emptyResponse: TransactionHistoryDetailQuery = { transactions: [] };

const populatedResponse: TransactionHistoryDetailQuery = {
  transactions: [
    {
      __typename: 'RegularTransaction',
      identifiers: ['identifier-1'],
      hash,
      fees: { paidFees: '1234' },
      transactionResult: { status: 'SUCCESS' },
      block: { hash: 'block-hash', height: 42, timestamp: 1_700_000_000 },
    },
  ],
};

const config: DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: new InMemoryTransactionHistoryStorage(DustTransactionHistoryEntrySchema),
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:9999/graphql' },
  // Keep the retry window short so the TestClock only has to advance a few seconds; the behaviour under test
  // (retry-then-succeed vs. exhaust-then-typed-fail) is independent of the production default (2 minutes).
  transactionDetailsRetryWindow: Duration.seconds(5),
};

/**
 * Fork the effect, fast-forward the TestClock past the whole retry window, then await the result. Retries in
 * `getTransactionDetails` sleep on the (test) clock, so advancing it releases each attempt without real waiting.
 */
const runToExit = <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(effect);
    yield* TestClock.adjust(Duration.seconds(60));
    return yield* Fiber.await(fiber);
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

describe('makeDefaultTransactionHistoryService.getTransactionDetails (dust)', () => {
  it('retries an empty indexer response and eventually returns the populated details', async () => {
    const service = makeDefaultTransactionHistoryService(config, () => undefined);

    const program = Effect.gen(function* () {
      // First call: the indexer has delivered the WS event but not yet ingested the tx over HTTP.
      // Second call: the tx is now indexed.
      const callCount = yield* Ref.make(0);
      const fakeQuery = () =>
        Ref.getAndUpdate(callCount, (n) => n + 1).pipe(
          Effect.map((n) => (n === 0 ? emptyResponse : populatedResponse)),
        );

      return yield* service
        .getTransactionDetails(hash)
        .pipe(Effect.provideService(TransactionHistoryDetail.tag, fakeQuery));
    });

    const exit = await runToExit(program);

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.hash).toBe(hash);
      expect(exit.value.status).toBe('SUCCESS');
      expect(exit.value.identifiers).toEqual(['identifier-1']);
      expect(exit.value.fees).toBe(1234n);
      expect(exit.value.block).toEqual({ hash: 'block-hash', height: 42, timestamp: 1_700_000_000 });
    }
  });

  it('fails with a typed TransactionHistoryError (not a defect) when the indexer never ingests the tx', async () => {
    const service = makeDefaultTransactionHistoryService(config, () => undefined);

    const program = service
      .getTransactionDetails(hash)
      // Indexer never catches up within the retry window.
      .pipe(Effect.provideService(TransactionHistoryDetail.tag, () => Effect.succeed(emptyResponse)));

    const exit = await runToExit(program);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // The failure must arrive as a typed Cause.Fail, not a Cause.Die defect.
      expect(Option.isNone(Cause.dieOption(exit.cause))).toBe(true);
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(TransactionHistoryError);
      }
    }
  });
});
