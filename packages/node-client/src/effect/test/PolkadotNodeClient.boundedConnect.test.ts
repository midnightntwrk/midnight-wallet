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
import { Cause, Duration, Effect, Exit, Fiber, Option, Scope } from 'effect';
import { describe, expect, it, vi } from 'vitest';

/**
 * A stub whose connection never establishes, standing in for a node that accepts nothing — the condition under which
 * `ApiPromise.create` waits indefinitely, because `WsProvider` retries on a timer and `throwOnConnect: false` means it
 * never rejects.
 */
vi.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: vi.fn(() => new Promise(() => {})),
  },
  WsProvider: vi.fn(),
}));

const { PolkadotNodeClient } = await import('../PolkadotNodeClient.js');

const makeClient = (reconnectionTimeout?: Duration.Duration) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();

    return yield* PolkadotNodeClient.make({
      nodeURL: new URL('ws://127.0.0.1:1'),
      ...(reconnectionTimeout === undefined ? {} : { reconnectionTimeout }),
    }).pipe(Effect.provideService(Scope.Scope, scope));
  });

/**
 * Runs `make` against a wall clock, reporting whether it settled at all.
 *
 * @remarks
 *   Racing here rather than relying on the test runner's timeout, so that a hang fails as an assertion naming what
 *   happened instead of as an opaque "timed out in 5000ms".
 */
const settleWithin = (millis: number, reconnectionTimeout?: Duration.Duration) =>
  Effect.race(
    makeClient(reconnectionTimeout).pipe(
      Effect.exit,
      Effect.map((exit) => ({ outcome: 'settled' as const, exit })),
    ),
    Effect.sleep(Duration.millis(millis)).pipe(Effect.as({ outcome: 'hung' as const, exit: undefined })),
  ).pipe(Effect.runPromise);

describe('PolkadotNodeClient.make', () => {
  it('should fail with a ConnectionError when a finite reconnectionTimeout elapses before the node answers', async () => {
    const result = await settleWithin(3_000, Duration.millis(200));

    expect(result.outcome).toBe('settled');
    const exit = result.exit;
    expect(exit !== undefined && Exit.isFailure(exit)).toBe(true);
    const failure =
      exit !== undefined && Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none<{ _tag: string }>();
    expect(Option.isSome(failure)).toBe(true);
    expect(Option.getOrThrow(failure)._tag).toBe('ConnectionError');
  });

  it('should not fire a finite timeout early when it exceeds the 32-bit setTimeout range', async () => {
    // `setTimeout` with a delay of 2^31ms or more overflows and fires after ~1ms, so a generous bound such as 30 days
    // failed every connection attempt instantly — the opposite of what the caller asked for. The delay is clamped to
    // the largest value `setTimeout` honours; a bound that large behaves as "still waiting" on any human timescale.
    //
    // Observed by polling rather than racing, for the same reason as the unbounded test below: the acquire is
    // uninterruptible, so a race against it can never resolve.
    const stillRunning = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDaemon(makeClient(Duration.days(30)));
        yield* Effect.sleep(Duration.millis(500));
        return yield* Fiber.poll(fiber);
      }).pipe(Effect.scoped),
    );

    expect(Option.isNone(stillRunning)).toBe(true);
  });

  it('should keep waiting when reconnectionTimeout is the default, so submission is unaffected', async () => {
    // Submission passes no timeout and relies on retrying until the node appears. That behaviour must not change: this
    // asserts the absence of a bound, which is the whole reason the bound is opt-in.
    //
    // Forked and polled rather than raced against a timer: `Effect.acquireRelease` acquires uninterruptibly, so a race
    // could never resolve and would report the runner's timeout instead of this property. Polling observes "has not
    // settled" without needing to interrupt anything. The fibre is left running, which is the point of the test.
    const stillRunning = await Effect.runPromise(
      Effect.gen(function* () {
        // `forkDaemon`, not `fork`: a child fibre is interrupted when its parent completes, and
        // interrupting an uninterruptible acquire would block the test forever.
        const fiber = yield* Effect.forkDaemon(makeClient());
        yield* Effect.sleep(Duration.millis(200));
        return yield* Fiber.poll(fiber);
      }).pipe(Effect.scoped),
    );

    expect(Option.isNone(stillRunning)).toBe(true);
  });
});
