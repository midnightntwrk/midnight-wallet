/**
 * This script uses midnight node toolkit to generate test transactions
 * Such approach, while potentially more involved when node version changes, has many benefits:
 * 1. It does not create a cyclic dependency on wallet code for such foundational package
 * 2. Transaction generator does save transactions into file, so they can be re-generated only when node changes its ledger version
 */
import { Effect, Encoding, pipe, Random } from 'effect';
import { type StartedTestContainer } from 'testcontainers';
import { Command, FileSystem } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import * as path from 'node:path';
import { TestContainers } from '../src/testing/index.ts';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as process from 'process';
import { gatherAndPrintCommandOutput, handleProcessExit } from './utils/command.ts';
import * as ledger from '@midnight-ntwrk/ledger';
import { HttpProverClient, ProverClient } from '@midnight-ntwrk/wallet-prover-client-ts/effect';
import { SerializedUnprovenTransaction } from '@midnight-ntwrk/abstractions';

const paths = new (class {
  currentDir = path.dirname(new URL(import.meta.url).pathname);
  packageDir = path.resolve(this.currentDir, '..');
  outputPath = path.resolve(this.packageDir, 'resources/test-txs.json');
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

const generateTransactions = (
  args: { nodePath: string },
  containers: { node: StartedTestContainer; proofServer: StartedTestContainer },
) => {
  // TODO: use docker when toolkit is bundled in the node image
  const command = Command.make(
    'target/release/mn-node-toolkit',
    ...[
      ['generate-txs'],
      ['--src-url', `ws://127.0.0.1:${containers.node.getMappedPort(9944)}`],
      ['--proof-server', `http://127.0.0.1:${containers.proofServer.getMappedPort(6300)}`],
      ['--dest-file', paths.outputPath],
      ['batches'],
      ['--num-txs-per-batch', '1'],
      ['--num-batches', '1'],
    ].flat(),
  ).pipe(
    Command.workingDirectory(args.nodePath),
    Command.runInShell(process.env['SHELL'] ?? true),
    Command.env({
      //Taken from the .direnv of node
      MIDNIGHT_LEDGER_TEST_STATIC_DIR: path.resolve(args.nodePath, 'static/contracts'),
    }),
  );

  return pipe(
    command,
    Command.start,
    Effect.flatMap(gatherAndPrintCommandOutput),
    Effect.flatMap((commandExit) => handleProcessExit(command, commandExit)),
  );
};

const generateUnbalancedTransaction = (proofServerContainer: StartedTestContainer) => {
  // Originally written with `Effect.gen`, but rewritten to Do notation to debug some typing issue
  // It seems to be a somewhat regular issue
  return Effect.Do.pipe(
    Effect.bind('value', () => Random.nextIntBetween(1, 100_000_000).pipe(Effect.map((nr) => BigInt(nr)))),
    Effect.let('unprovenTx', ({ value }) => {
      const recipient = ledger.SecretKeys.fromSeed(new Uint8Array(32).fill(0));
      const coin = ledger.createCoinInfo(ledger.nativeToken(), value);
      const unprovenOutput = ledger.UnprovenOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
      const unprovenOffer = ledger.UnprovenOffer.fromOutput(unprovenOutput, ledger.nativeToken(), value);
      return new ledger.UnprovenTransaction(unprovenOffer);
    }),
    Effect.flatMap(({ unprovenTx }) =>
      Effect.gen(function* () {
        const serializedTx = SerializedUnprovenTransaction(unprovenTx.serialize(ledger.NetworkId.Undeployed));
        const proverClient = yield* ProverClient.ProverClient;
        return yield* proverClient.proveTransaction(serializedTx);
      }),
    ),
    Effect.provide(
      HttpProverClient.layer({
        url: new URL(`http://127.0.0.1:${proofServerContainer.getMappedPort(6300)}`),
      }),
    ),
  );
};

const saveUnbalancedTransaction = (tx: Uint8Array) => {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const outputFileData: any = yield* fs
      .readFileString(paths.outputPath, 'utf8')
      .pipe(Effect.map((str) => JSON.parse(str)));
    const augmentedOutput = {
      ...outputFileData,
      unbalanced_tx: Encoding.encodeHex(tx),
    };
    yield* fs.writeFileString(paths.outputPath, JSON.stringify(augmentedOutput));
  });
  /* eslint-enable */
};

const main = Effect.gen(function* () {
  const args = yield* parseArgs;

  yield* removeSyncCache(args);
  yield* prepareDestDir;
  const proofServer = yield* TestContainers.runProofServerContainer();
  const node = yield* TestContainers.runNodeContainer();
  const [, unbalancedTx] = yield* Effect.all(
    [generateTransactions(args, { node, proofServer }), generateUnbalancedTransaction(proofServer)],
    { concurrency: 'unbounded' },
  );

  yield* saveUnbalancedTransaction(unbalancedTx);
}).pipe(Effect.scoped, Effect.provide(NodeContext.layer));

NodeRuntime.runMain(main);
