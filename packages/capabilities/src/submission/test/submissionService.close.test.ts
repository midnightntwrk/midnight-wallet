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
import { Cause, Duration, Effect, Exit, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

/** Every provider the node client created, in order, with whether it was disconnected — what stops its retries. */
const providers = vi.hoisted(() => [] as Array<{ disconnected: boolean }>);

/**
 * A node that accepts nothing: `ApiPromise.create` waits indefinitely against one, because `WsProvider` retries on a
 * timer and the client creates it with `throwOnConnect: false`, so it never rejects.
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

const { makeDefaultSubmissionServiceEffect } = await import('../submissionService.js');

const UNREACHABLE_RELAY = new URL('ws://127.0.0.1:1');

/** The submission service reads nothing from a transaction but its bytes, so this stands in for a finalized one. */
type StubTransaction = { serialize: () => Uint8Array; toString: () => string };
const stubTransaction: StubTransaction = { serialize: () => new Uint8Array(), toString: () => 'stub transaction' };

const makeService = () => makeDefaultSubmissionServiceEffect<StubTransaction>({ relayURL: UNREACHABLE_RELAY });

/**
 * Runs `effect` against a wall clock: its exit if it settled within `millis`, `None` if it was still running.
 *
 * @remarks
 *   Racing here rather than relying on the test runner's timeout, so that a hang fails as an assertion naming what
 *   happened instead of as an opaque "timed out".
 */
const exitWithin = <A, E>(effect: Effect.Effect<A, E>, millis: number): Promise<Option.Option<Exit.Exit<A, E>>> =>
  effect.pipe(Effect.exit, Effect.timeout(Duration.millis(millis)), Effect.option, Effect.runPromise);

describe('Closing the default submission service while its node is unreachable', () => {
  it('should settle, so a wallet whose node is down can still be stopped', async () => {
    const closed = await exitWithin(makeService().close(), 1_000);

    expect(Option.isSome(closed)).toBe(true);
  });

  it('should disconnect from the node, so nothing keeps retrying once the wallet is stopped', async () => {
    const createdBefore = providers.length;

    await exitWithin(makeService().close(), 1_000);

    const created = providers.slice(createdBefore);
    expect(created).toHaveLength(1);
    expect(created[0]?.disconnected).toBe(true);
  });

  it('should fail a submission made after it closed with a SubmissionError, rather than leave it waiting', async () => {
    const service = makeService();
    await exitWithin(service.close(), 1_000);

    const submitted = await exitWithin(service.submitTransaction(stubTransaction, 'InBlock'), 1_000);

    expect(Option.isSome(submitted)).toBe(true);
    const exit = Option.getOrThrow(submitted);
    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none<{ _tag: string }>();
    expect(Option.map(failure, (error) => error._tag)).toEqual(Option.some('SubmissionError'));
  });
});
