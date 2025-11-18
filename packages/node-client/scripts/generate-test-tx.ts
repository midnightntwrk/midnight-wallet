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
import { Effect } from 'effect';
import { FileSystem } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import * as path from 'node:path';
import { TestContainers } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as process from 'process';
import { generateTestTransactions } from '../src/testing/test-transactions.js';

const paths = new (class {
  currentDir = path.dirname(new URL(import.meta.url).pathname);
  packageDir = path.resolve(this.currentDir, '..');
  outputPath = path.resolve(this.packageDir, 'resources');
  fileName = 'test-txs.json';
  repositoryRoot = path.resolve(this.packageDir, '..', '..');
})();

const argsSpec = yargs().option('node-path', {
  default: path.resolve(paths.repositoryRoot, '..', 'midnight-node'),
  type: 'string',
  describe: 'Path to node repo',
});

const parseArgs = Effect.sync(() => argsSpec.parseSync(hideBin(process.argv)));
type Args = {
  nodePath: string;
};

const removeSyncCache = (args: Args) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(path.resolve(args.nodePath, '.sync_cache'), { force: true, recursive: true });
  });

const prepareDestDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(path.dirname(paths.outputPath), {
    recursive: true,
  });
});

const main = Effect.gen(function* () {
  const args = yield* parseArgs;

  yield* removeSyncCache(args);
  yield* prepareDestDir;

  const network = yield* TestContainers.createNetwork();
  const proofServer = yield* TestContainers.runProofServerContainer();

  yield* TestContainers.runNodeContainer((c) => c.withNetwork(network).withNetworkAliases('midnight-node'));

  yield* generateTestTransactions(
    'ws://midnight-node:9944',
    `http://127.0.0.1:${proofServer.getMappedPort(6300)}`,
    network,
    paths.outputPath,
    paths.fileName,
  );
}).pipe(Effect.scoped, Effect.provide(NodeContext.layer));

NodeRuntime.runMain(main);
