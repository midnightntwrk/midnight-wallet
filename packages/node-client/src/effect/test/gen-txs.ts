import { FileSystem } from '@effect/platform';
import { Effect, Scope } from 'effect';
import path from 'path';
import { StartedNetwork } from 'testcontainers';
import { generateTestTransactions } from '../../testing/test-transactions';
import { PlatformError } from '@effect/platform/Error';
import { NodeContext } from '@effect/platform-node';

const paths = new (class {
  currentDir = path.dirname(new URL(import.meta.url).pathname);
  outputPath = path.resolve(this.currentDir, 'tmp');
  fileName = 'test-txs.json';
})();

export const getTestTxsPath = (): string => `${paths.outputPath}/${paths.fileName}`;

const cleanDir = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(getTestTxsPath(), { force: true, recursive: true });
  });

export const generateTxs = (
  nodeUrl: string,
  proofServerUrl: string,
  network: StartedNetwork,
): Effect.Effect<void, Error | PlatformError, Scope.Scope> =>
  Effect.gen(function* () {
    yield* cleanDir();
    yield* generateTestTransactions(nodeUrl, proofServerUrl, network, paths.outputPath, paths.fileName);
  }).pipe(Effect.provide(NodeContext.layer));
