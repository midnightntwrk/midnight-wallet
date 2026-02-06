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
/**
 * IMPORTANT: This file isn't used in the current test setup as we generate the txs before running the tests (please see gen-txs.ts instead)
 *
 * This script uses midnight node toolkit to generate test transactions
 * Such approach, while potentially more involved when node version changes, has many benefits:
 * 1. It does not create a cyclic dependency on wallet code for such foundational package
 * 2. Transaction generator does save transactions into file, so they can be re-generated only when node changes its ledger version
 */
import { DateTime, Duration, Effect, Option, pipe } from 'effect';
import { FileSystem } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { TestContainers } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import * as TestTransactions from '../src/testing/test-transactions.js';
import { Wait } from 'testcontainers';

const prepareDestDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(TestTransactions.defaultPaths.outputPath, {
    recursive: true,
  });
  yield* fs.remove(TestTransactions.defaultPaths.fullPath, { force: true });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- we skip test tx generation as the tests are skipped too due to issues with replaying transactions
const main = Effect.gen(function* () {
  const presentTTL = yield* TestTransactions.load(TestTransactions.defaultPaths.fullPath).pipe(
    Effect.flatMap(TestTransactions.getTTL),
    Effect.catchAll((err) => Effect.logError(err).pipe(Effect.as(Option.none<DateTime.Utc>()))),
  );
  const shouldSkip = yield* Option.match(presentTTL, {
    onNone: () => Effect.succeed(false),
    onSome: (ttl) => pipe(ttl, DateTime.subtractDuration(Duration.minutes(2)), DateTime.isFuture),
  });

  if (shouldSkip) {
    return;
  }

  yield* prepareDestDir;

  const network = yield* TestContainers.createNetwork();
  const hostProofServerContainer = yield* TestContainers.runProofServerContainer();
  const networkProofServerContainer = yield* TestContainers.runProofServerContainer((c) =>
    c.withNetwork(network).withNetworkAliases('proof-server'),
  );
  const nodeContainer = yield* TestContainers.runNodeContainer((c) =>
    c.withNetwork(network).withNetworkAliases('midnight-node').withWaitStrategy(Wait.forLogMessage('Imported #1')),
  );

  yield* TestTransactions.generateTestTransactions(
    {
      nodeContainer,
      hostProofServerContainer,
      networkProofServerContainer,
      network,
    },
    TestTransactions.defaultPaths,
  );
}).pipe(Effect.scoped, Effect.provide(NodeContext.layer));

// We skip test tx generation as the tests are skipped too due to issues with replaying transactions
NodeRuntime.runMain(Effect.succeed(undefined));
