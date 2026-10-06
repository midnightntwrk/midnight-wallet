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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as EArray, Chunk, Deferred, Effect, Queue, type Scope, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { StateChange, type Variant, type VariantBuilder, type WalletRuntimeError } from '../abstractions/index.js';
import { WalletBuilder } from '../WalletBuilder.js';

// A syncing wallet publishes a new state for every applied batch, and each state holds wasm-backed ledger objects. If
// the runtime's state stream keeps superseded states alive (for a subscriber that lags, or for every subscriber), the
// heap grows with the number of batches applied and a long catch-up runs out of memory.

const Pushing = 'Pushing' as const;

type Step = { readonly n: number };

type PushingRunningVariant = Variant.RunningVariant<typeof Pushing, Step> & {
  readonly push: (state: Step) => Effect.Effect<void>;
};

/**
 * A variant whose states are pushed by the test. Built on a plain queue rather than the intercepting test variant's
 * replaying PubSub, so that nothing inside the variant holds on to past states and any retention observed is the
 * runtime's.
 */
class PushingVariant implements Variant.Variant<typeof Pushing, Step, Step, PushingRunningVariant> {
  __polyTag__ = Pushing;

  migrateState(previousState: Step): Effect.Effect<Step, WalletRuntimeError> {
    return Effect.succeed(previousState);
  }

  protocolVersionOf(): ProtocolVersion.ProtocolVersion {
    return ProtocolVersion.MinSupportedVersion;
  }

  start(): Effect.Effect<PushingRunningVariant, WalletRuntimeError, Scope.Scope> {
    return Queue.bounded<StateChange.StateChange<Step>>(1).pipe(
      Effect.map((queue) => ({
        __polyTag__: Pushing,
        state: Stream.fromQueue(queue),
        push: (state: Step) => Queue.offer(queue, StateChange.State({ state })).pipe(Effect.asVoid),
      })),
    );
  }
}

class PushingVariantBuilder implements VariantBuilder.VariantBuilder<PushingVariant> {
  build(): PushingVariant {
    return new PushingVariant();
  }
}

const startWallet = () => {
  const Wallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, new PushingVariantBuilder())
    .build();
  return Wallet.startFirst(Wallet, { n: 0 });
};

type Wallet = ReturnType<typeof startWallet>;

const push = (wallet: Wallet, state: Step): Promise<void> =>
  wallet.runtime.dispatch({ [Pushing]: (variant) => variant.push(state) }).pipe(Effect.runPromise);

/** Pushes `1..count` in order, waiting for each to be accepted, and returns them. */
const pushAll = (wallet: Wallet, count: number): Promise<readonly Step[]> => {
  const steps = EArray.makeBy(count, (i) => ({ n: i + 1 }));
  return steps.reduce((done, step) => done.then(() => push(wallet, step)), Promise.resolve()).then(() => steps);
};

/**
 * Subscribes to the runtime's state stream with a consumer that takes the first state and then blocks until `release`
 * is completed, and collects every state it receives up to and including `{ n: last }`.
 */
const laggingSubscriber = (wallet: Wallet, last: number) =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    const received = wallet.runtime.stateChanges.pipe(
      Stream.map(({ state }) => state),
      Stream.takeUntil((state) => state.n === last),
      Stream.mapEffect((state) =>
        state.n === 0 ? Deferred.await(release).pipe(Effect.as(state)) : Effect.succeed(state),
      ),
      Stream.runCollect,
      Effect.map(Chunk.toReadonlyArray),
      Effect.runPromise,
    );
    return { release, received };
  }).pipe(Effect.runSync);

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Lets the stream fibers run until the runtime has stopped moving. */
const settle = async (rounds = 20): Promise<void> => {
  await EArray.makeBy(rounds, () => nextMacrotask).reduce((done, next) => done.then(next), Promise.resolve());
};

describe('Runtime state stream retention', () => {
  const published = 1000;

  it('hands a lagging subscriber only the latest state, not every state it fell behind on', async () => {
    const wallet = startWallet();
    const { release, received } = laggingSubscriber(wallet, published);
    await settle();

    await pushAll(wallet, published);
    await settle();
    await Effect.runPromise(Deferred.succeed(release, undefined));

    const states = await received;
    await wallet.stop();

    expect(states.at(-1)).toEqual({ n: published });
    // The state it was blocked on, then at most the one buffered behind it and the latest.
    expect(states.filter(({ n }) => n > 0).length).toBeLessThanOrEqual(2);
  });

  it('lets superseded states be garbage-collected while a subscriber stays attached', async () => {
    // The unit project starts its workers with --expose-gc (see vitest.config.ts); without it there is nothing to measure.
    const gc = globalThis.gc;
    expect(gc).toBeDefined();

    const wallet = startWallet();
    const { release, received } = laggingSubscriber(wallet, published);
    await settle();

    const refs = await pushAll(wallet, published).then((steps) => steps.map((step) => new WeakRef(step)));
    await settle();
    gc?.();
    await nextMacrotask();
    gc?.();

    // Still reachable by design: the current state in the runtime's ref, and at most one state in the lagging
    // subscriber's buffer. Everything older must have been released, or a long sync holds every state it ever had.
    const alive = refs.filter((ref) => ref.deref() !== undefined).length;

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await received;
    await wallet.stop();

    expect(alive).toBeLessThanOrEqual(2);
  });
});
