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
import { Cause, Console, Data, Effect, Exit, Fiber, pipe, Stream } from 'effect';
import { Command, CommandExecutor, Error } from '@effect/platform';

const printStream = <E, R>(stream: Stream.Stream<Uint8Array, E, R>): Effect.Effect<Fiber.Fiber<void, E>, never, R> =>
  pipe(stream, Stream.decodeText('utf-8'), Stream.splitLines, Stream.tap(Console.log), Stream.runDrain, Effect.fork);

export class CommandFailureError extends Data.TaggedError(
  '@midnight-ntwrk/node-client/scripts/utils/command#CommandFailureError',
)<{ command: Command.Command; exitCode: number }> {}

export const gatherAndPrintCommandOutput = (
  process: CommandExecutor.Process,
): Effect.Effect<Exit.Exit<number, Error.PlatformError>> => {
  const exitCode = process.exitCode.pipe(
    Effect.flatMap((code) => Console.log('Process exit code', code).pipe(Effect.as(code))),
    Effect.fork,
  );

  const stdout = printStream(process.stdout);
  const stderr = printStream(process.stderr);

  return Effect.gen(function* () {
    const exitCodeFiber = yield* exitCode;
    const stdoutFiber = yield* stdout;
    const stderrFiber = yield* stderr;

    const exit = yield* Fiber.await(exitCodeFiber);
    yield* Fiber.await(stdoutFiber);
    yield* Fiber.await(stderrFiber);

    return exit;
  });
};

export const handleProcessExit = (
  command: Command.Command,
  exit: Exit.Exit<number, Error.PlatformError>,
): Effect.Effect<void, Cause.Cause<Error.PlatformError> | CommandFailureError> => {
  return Exit.match(exit, {
    onFailure: (cause) => Effect.fail(cause),
    onSuccess: (code) =>
      code === 0
        ? Effect.void
        : Console.error('Command failed: ', command).pipe(
            Effect.andThen(
              Effect.fail(
                new CommandFailureError({
                  command,
                  exitCode: code,
                }),
              ),
            ),
          ),
  });
};
