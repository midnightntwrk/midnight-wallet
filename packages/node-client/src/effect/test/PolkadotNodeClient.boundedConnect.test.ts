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
 * Every provider the client created, in order, with whether it was disconnected — the only thing that stops its
 * retries.
 */
const providers = vi.hoisted(() => [] as Array<{ disconnected: boolean }>);

/**
 * A stub whose connection never establishes, standing in for a node that accepts nothing — the condition under which
 * `ApiPromise.create` waits indefinitely, because `WsProvider` retries on a timer and `throwOnConnect: false` means it
 * never rejects.
 */
vi.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: vi.fn(() => new Promise(() => {})),
  },
  WsProvider: class {
    disconnected = false;

    constructor() {
      providers.push(this);
    }

    disconnect(): Promise<void> {
      this.disconnected = true;
      return Promise.resolve();
    }
  },
}));

const { PolkadotNodeClient } = await import('../PolkadotNodeClient.js');
const { ApiPromise } = await import('@polkadot/api');

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
  it('should connect within a finite reconnectionTimeout even when the first socket attempt errors', async () => {
    // With `throwOnConnect: true`, `ApiPromise.create` returns `isReadyOrError`, which rejects on the provider's first
    // `error` event — any socket error, such as a node restarting — although `WsProvider` would have retried and
    // connected a moment later. A bounded caller therefore failed within milliseconds and never used the window it
    // asked for. The stub mirrors the library: rejection on the first error when throwing on connect, otherwise the
    // connection lands after a retry. The api it yields is already disconnected, so `make()` has no close to wait for.
    vi.mocked(ApiPromise).create.mockImplementationOnce((options) =>
      options?.throwOnConnect
        ? Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1'))
        : new Promise((resolve) =>
            setTimeout(
              // Type cast required because: the client only reads `isConnected` from the api during make(); a full
              // ApiPromise double would drag the whole polkadot surface into a test about one connection option.
              () => resolve({ isConnected: false } as unknown as Awaited<ReturnType<typeof ApiPromise.create>>),
              50,
            ),
          ),
    );

    const result = await settleWithin(3_000, Duration.seconds(1));

    expect(result.outcome).toBe('settled');
    expect(result.exit !== undefined && Exit.isSuccess(result.exit)).toBe(true);
  });

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
    // failed every connection attempt instantly — the opposite of what the caller asked for. Effect's clock treats a
    // delay beyond what `setTimeout` honours as one that never elapses; a bound that large behaves as "still waiting"
    // on any human timescale.
    //
    // Observed by polling rather than racing, for the same reason as the unbounded test below.
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
    // Forked and polled rather than raced against a timer: polling observes "has not settled" without ending the
    // attempt it observes. The fibre is left running, which is the point of the test.
    const stillRunning = await Effect.runPromise(
      Effect.gen(function* () {
        // `forkDaemon`, not `fork`: a child fibre is interrupted when its parent completes, which would end the
        // attempt this test means to leave running.
        const fiber = yield* Effect.forkDaemon(makeClient());
        yield* Effect.sleep(Duration.millis(200));
        return yield* Fiber.poll(fiber);
      }).pipe(Effect.scoped),
    );

    expect(Option.isNone(stillRunning)).toBe(true);
  });

  it('should stop connecting once interrupted while the node is unreachable, so its owner can always tear it down', async () => {
    // A caller closing a wallet whose node never answered interrupts the connection attempt. The attempt has produced no
    // client to release, so it has to disconnect the provider itself; the caller's scope is left open here to show that
    // the disconnect does not wait for it.
    const createdBefore = providers.length;

    const interrupted = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDaemon(makeClient());
        yield* Effect.sleep(Duration.millis(100));
        return yield* Fiber.interrupt(fiber).pipe(Effect.timeout(Duration.seconds(1)), Effect.option);
      }),
    );

    expect(Option.isSome(interrupted)).toBe(true);
    const created = providers.slice(createdBefore);
    expect(created).toHaveLength(1);
    expect(created[0]?.disconnected).toBe(true);
  });

  it('should fail within a finite reconnectionTimeout even for a caller that cannot be interrupted, so the bound always holds', async () => {
    // The liveness check builds its client uninterruptibly, so that a poll failing fast cannot strand a built client
    // before it is cached. The bound it asks for must therefore hold without anyone interrupting the attempt. Forked and
    // polled rather than raced, because a race would wait for an uninterruptible loser and hang instead of failing.
    const createdBefore = providers.length;

    const settled = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDaemon(Effect.uninterruptible(makeClient(Duration.millis(200))));
        yield* Effect.sleep(Duration.seconds(1));
        return yield* Fiber.poll(fiber);
      }),
    );

    expect(Option.isSome(settled)).toBe(true);
    const exit = Option.getOrThrow(settled);
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none<{ _tag: string }>();
    expect(Option.map(failure, (error) => error._tag)).toEqual(Option.some('ConnectionError'));
    const created = providers.slice(createdBefore);
    expect(created).toHaveLength(1);
    expect(created[0]?.disconnected).toBe(true);
  });
});
