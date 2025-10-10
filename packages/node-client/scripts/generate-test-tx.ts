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
