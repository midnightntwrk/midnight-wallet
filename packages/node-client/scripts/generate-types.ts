/**
 * This script calls polkadot codegen to generate types for a Midnight's Node Runtime
 * For unknown reason though, the generated code does not work out of the box, and there is a bunch of issues reported
 * One possible cause is our usage of pnpm linker (which is needed for as long as we have Scala code present)
 * For that reason the current flow for updating type definitions is:
 * 1. Ensure package.json field "referenceNodeVersion" contains right value
 * 2. Call this script, e.g. with `yarn turbo polkadot-typegen` in the repository root directory
 * 3. Edit contents of files generated at `src/gen` directory to one's needs
 */

import { Console, Effect, pipe, Stream } from 'effect';
import { type StartedTestContainer } from 'testcontainers';
import { Command, FileSystem } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import * as path from 'node:path';
import { gatherAndPrintCommandOutput, handleProcessExit } from './utils/command.ts';
import { TestContainers } from '../src/testing/index.ts';

const paths = new (class {
  currentDir = path.dirname(new URL(import.meta.url).pathname);
  genDir = path.resolve(this.currentDir, '../src/gen');
  packageDir = path.resolve(this.currentDir, '..');
  genRelativeToPackage = path.relative(this.packageDir, this.genDir);
})();

const prepareGenDirectory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(paths.genDir, { recursive: true, force: true });
  yield* fs.makeDirectory(paths.genDir, { recursive: true });
});

const generateTypes = (container: StartedTestContainer) => {
  const command = Command.make(
    'polkadot-types-from-chain',
    ...[
      [`--endpoint`, `ws://localhost:${container.getMappedPort(9944)}`],
      [`--output`, paths.genRelativeToPackage],
      ['--strict'],
    ].flat(),
  );

  return pipe(
    command,
    Command.start,
    Effect.flatMap(gatherAndPrintCommandOutput),
    Effect.flatMap((commandExit) => handleProcessExit(command, commandExit)),
  );
};

const insertMissingImports = (() => {
  const prefixToAdd = `/* eslint-disable */
/**
 * Auto-generated with scripts/generate-types.ts
 * Then manually modified to only expose types and endpoints of interest
 */
  `;
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs.readDirectory(paths.genDir, { recursive: true });

    yield* Stream.fromIterable(files).pipe(
      Stream.tap((item) => {
        return Console.log(item);
      }),
      Stream.filter((name) => name != `augment-api.ts`),
      Stream.map((filename) => path.resolve(paths.genDir, filename)),
      Stream.mapEffect((file: string) => {
        return Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          const contents = yield* fs.readFileString(file, 'utf-8');
          const updatedContents = prefixToAdd.concat(contents);
          yield* fs.writeFileString(file, updatedContents);
        });
      }),
      Stream.runDrain,
    );
  });
})();

const main = pipe(
  prepareGenDirectory,
  Effect.andThen(TestContainers.runNodeContainer()),
  Effect.andThen(generateTypes),
  Effect.andThen(insertMissingImports),
  Effect.provide(NodeContext.layer),
  Effect.scoped,
);

NodeRuntime.runMain(main);
