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
import { type ProtocolState, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Deferred, Effect, Either, Option, Ref } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { StateChange, VersionChangeType, WalletRuntimeError } from '../abstractions/index.js';
import { isOrderedSubsequenceOf, protocolStateEquals, toProtocolStateArray } from '../testing/utils.js';
import {
  type InterceptingRunningVariant,
  InterceptingVariantBuilder,
  Numeric,
  NumericMultiplier,
  NumericRangeBuilder,
  NumericRangeMultiplierBuilder,
} from '../testing/variants.js';
import { WalletBuilder } from '../WalletBuilder.js';

/**
 * Records variant-activation notifications: `record(tag)` appends the tag and completes `done` once `expectedCount`
 * activations have been observed.
 */
const makeActivationRecorder = (expectedCount: number) =>
  Effect.gen(function* () {
    const tagsRef = yield* Ref.make<readonly string[]>([]);
    const doneSignal = yield* Deferred.make<void>();
    const record = (tag: string): Effect.Effect<void> =>
      Ref.updateAndGet(tagsRef, (tags) => [...tags, tag]).pipe(
        Effect.flatMap((tags) =>
          tags.length >= expectedCount ? Deferred.succeed(doneSignal, void 0) : Effect.succeed(false),
        ),
        Effect.asVoid,
      );
    return {
      tags: Ref.get(tagsRef),
      done: Deferred.await(doneSignal).pipe(Effect.timeout('2 seconds')),
      record,
    };
  });

describe('Wallet runtime', () => {
  it('allows to dispatch a poly function on a running variant', async () => {
    const interceptingTag = 'intercept' as const;
    const builder = WalletBuilder.init()
      // Have the first variant complete after producing two values, signifying a protocol change.
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(
        ProtocolVersion.ProtocolVersion(50n),
        new InterceptingVariantBuilder<typeof interceptingTag, number>(interceptingTag),
      )
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const Wallet = builder.build({
      min: 0,
      max: 4,
      multiplier: 2,
    });
    const wallet = Wallet.startEmpty(Wallet);

    // The state stream has latest-value semantics: a subscriber always converges on the latest
    // state, but may skip intermediate states when it lags behind the producer. Collect until the
    // terminal state arrives and assert order-preserving delivery against the full emission.
    const fullStateSequence = [
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 1 },
      { version: ProtocolVersion.ProtocolVersion(50n), state: 1 }, // This is expected to be emitted by the intercepting variant
      { version: ProtocolVersion.ProtocolVersion(100n), state: 4 }, // This is the rest
      { version: ProtocolVersion.ProtocolVersion(100n), state: 6 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 8 },
    ];
    const allCollectedState = toProtocolStateArray<number>(
      wallet.rawState.pipe(rx.takeWhile(({ state }: ProtocolState.ProtocolState<number>) => state !== 8, true)),
    );

    // Let's wait for the intercepting variant to be initiated to remove any chance of races
    await rx.firstValueFrom(
      wallet.rawState.pipe(rx.find(({ version }) => version == ProtocolVersion.ProtocolVersion(50n))),
    );

    const dispatchResult = await wallet.runtime
      .dispatch({
        [Numeric]: () => Effect.succeed(false),
        [NumericMultiplier]: () => Effect.succeed(false),
        [interceptingTag]: (interceptingVariant) =>
          interceptingVariant
            .emitProtocolVersionChange(VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }))
            .pipe(Effect.as(true)),
      })
      .pipe(Effect.runPromise);

    expect(dispatchResult).toBe(true);
    const receivedStates = await allCollectedState;
    expect(receivedStates.at(-1)).toEqual({ version: ProtocolVersion.ProtocolVersion(100n), state: 8 });
    expect(receivedStates).toSatisfy((received: typeof receivedStates) =>
      isOrderedSubsequenceOf(received, fullStateSequence, protocolStateEquals),
    );
  });

  it('allows wallet to implement own starting procedure', async () => {
    const builder = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const BaseWallet = builder.build({
      min: 0,
      max: 46,
      multiplier: 2,
    });
    class Wallet extends BaseWallet {
      static startFrom(nr: number): Wallet {
        return Wallet.startFirst(Wallet, nr);
      }
    }

    const wallet = Wallet.startFrom(42);

    expect(wallet).toBeInstanceOf(BaseWallet);
    expect(wallet).toBeInstanceOf(Wallet);

    // Latest-value semantics: intermediate states may be skipped, but order is preserved and the
    // stream converges on the terminal state.
    const fullStateSequence = [
      { version: ProtocolVersion.MinSupportedVersion, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, state: 43 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), state: 88 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 90 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 92 },
    ];
    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }: ProtocolState.ProtocolState<number>) => state !== 92, true)),
    );

    expect(receivedStates.at(-1)).toEqual({ version: ProtocolVersion.ProtocolVersion(100n), state: 92 });
    expect(receivedStates).toSatisfy((received: typeof receivedStates) =>
      isOrderedSubsequenceOf(received, fullStateSequence, protocolStateEquals),
    );
  });

  it('allows to start from arbitrary variant by providing its state', async () => {
    const Intercepting = 'intercepting' as const;
    const builder = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(
        ProtocolVersion.ProtocolVersion(50n),
        new InterceptingVariantBuilder<typeof Intercepting, number>(Intercepting),
      )
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const Wallet = builder.build({
      min: 0,
      max: 44,
      multiplier: 2,
    });
    const wallet = Wallet.start(Wallet, Intercepting, 42);

    // Latest-value semantics: intermediate states may be skipped, but order is preserved and the
    // stream converges on the terminal state.
    const fullStateSequence = [
      { version: ProtocolVersion.ProtocolVersion(50n), state: 42 }, // this is the state we provided, and runtime automatically emits it
      { version: ProtocolVersion.ProtocolVersion(50n), state: 42 }, // the intercepting variant emits it again on start
      { version: ProtocolVersion.ProtocolVersion(100n), state: 86 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 88 },
    ];
    const allCollectedState = toProtocolStateArray<number>(
      wallet.rawState.pipe(rx.takeWhile(({ state }: ProtocolState.ProtocolState<number>) => state !== 88, true)),
    );

    await wallet.runtime
      .dispatch({
        [Numeric]: () => Effect.void,
        [NumericMultiplier]: () => Effect.void,
        [Intercepting]: (interceptingVariant: InterceptingRunningVariant<typeof Intercepting, number>) =>
          interceptingVariant.emitProtocolVersionChange(VersionChangeType.Next()),
      })
      .pipe(Effect.runPromise);

    const receivedStates = await allCollectedState;
    expect(receivedStates.at(-1)).toEqual({ version: ProtocolVersion.ProtocolVersion(100n), state: 88 });
    expect(receivedStates).toSatisfy((received: typeof receivedStates) =>
      isOrderedSubsequenceOf(received, fullStateSequence, protocolStateEquals),
    );
  });

  it('allows to start from the first variant by providing its state', async () => {
    const builder = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const Wallet = builder.build({
      min: 0,
      max: 46,
      multiplier: 2,
    });

    const wallet = Wallet.startFirst(Wallet, 42);

    // Latest-value semantics: intermediate states may be skipped, but order is preserved and the
    // stream converges on the terminal state.
    const fullStateSequence = [
      { version: ProtocolVersion.MinSupportedVersion, state: 42 }, // The initial state is emitted both by runtime and the variant
      { version: ProtocolVersion.MinSupportedVersion, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, state: 43 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), state: 88 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 90 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 92 },
    ];
    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }: ProtocolState.ProtocolState<number>) => state !== 92, true)),
    );

    expect(receivedStates.at(-1)).toEqual({ version: ProtocolVersion.ProtocolVersion(100n), state: 92 });
    expect(receivedStates).toSatisfy((received: typeof receivedStates) =>
      isOrderedSubsequenceOf(received, fullStateSequence, protocolStateEquals),
    );
  });

  it('reports progress updates from variant through runtime.progress', async () => {
    const progressTag = 'progress' as const;
    const Wallet = WalletBuilder.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new InterceptingVariantBuilder<typeof progressTag, number>(progressTag),
      )
      .build();
    const wallet = Wallet.startEmpty(Wallet);

    // Wait for the intercepting variant to be initiated
    await rx.firstValueFrom(wallet.rawState);

    // Initial progress should be zero
    const initialProgress = await Effect.runPromise(wallet.runtime.progress);
    expect(initialProgress).toMatchObject({ sourceGap: 0n, applyGap: 0n });

    // Emit a ProgressUpdate with non-zero gaps, followed by a State change as a synchronization point
    await wallet.runtime
      .dispatch({
        [progressTag]: (variant) =>
          variant
            .emit(StateChange.ProgressUpdate({ sourceGap: 10n, applyGap: 5n }))
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 42 })))),
      })
      .pipe(Effect.runPromise);

    // Wait for the State change to arrive, ensuring the preceding ProgressUpdate has been processed
    await rx.firstValueFrom(wallet.rawState.pipe(rx.filter(({ state }) => state === 42)));

    const midProgress = await Effect.runPromise(wallet.runtime.progress);
    expect(midProgress).toMatchObject({ sourceGap: 10n, applyGap: 5n });

    // Emit a ProgressUpdate showing sync is complete, followed by another State change
    await wallet.runtime
      .dispatch({
        [progressTag]: (variant) =>
          variant
            .emit(StateChange.ProgressUpdate({ sourceGap: 0n, applyGap: 0n }))
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 43 })))),
      })
      .pipe(Effect.runPromise);

    await rx.firstValueFrom(wallet.rawState.pipe(rx.filter(({ state }) => state === 43)));

    const finalProgress = await Effect.runPromise(wallet.runtime.progress);
    expect(finalProgress).toMatchObject({ sourceGap: 0n, applyGap: 0n });

    await wallet.stop();
  });

  it('updates protocol version annotation without migrating when version change is within valid range', async () => {
    const interceptingTag = 'intercept' as const;
    const Wallet = WalletBuilder.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new InterceptingVariantBuilder<typeof interceptingTag, number>(interceptingTag),
      )
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder())
      .build({ min: 0, max: 10, multiplier: 2 });
    const wallet = Wallet.startEmpty(Wallet);

    // Wait for the intercepting variant to be initiated
    await rx.firstValueFrom(wallet.rawState);

    // Emit a VersionChange to version 50n, which is within the current variant's valid range [0n, 100n)
    // This should NOT trigger migration — only update the protocol version annotation
    await wallet.runtime
      .dispatch({
        [interceptingTag]: (variant) =>
          variant
            .emitProtocolVersionChange(VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(50n) }))
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 42 })))),
        [NumericMultiplier]: () => Effect.void,
      })
      .pipe(Effect.runPromise);

    // The state emission after the version change should carry the updated version 50n
    const stateAfterVersionChange = await rx.firstValueFrom(
      wallet.rawState.pipe(rx.filter(({ state }) => state === 42)),
    );
    expect(stateAfterVersionChange).toEqual({ version: ProtocolVersion.ProtocolVersion(50n), state: 42 });

    // Verify the variant was NOT migrated — we can still dispatch to the intercepting variant
    const stillIntercepting = await wallet.runtime
      .dispatch({
        [interceptingTag]: () => Effect.succeed(true),
        [NumericMultiplier]: () => Effect.succeed(false),
      })
      .pipe(Effect.runPromise);
    expect(stillIntercepting).toBe(true);

    await wallet.stop();
  });

  it('ignores VersionChangeType.Next when there is no next variant', async () => {
    const interceptingTag = 'sole' as const;
    const Wallet = WalletBuilder.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new InterceptingVariantBuilder<typeof interceptingTag, number>(interceptingTag),
      )
      .build();
    const wallet = Wallet.startEmpty(Wallet);

    // Wait for the intercepting variant to be initiated
    await rx.firstValueFrom(wallet.rawState);

    // Emit VersionChangeType.Next() — with no next variant, nextProtocolVersion is null,
    // so this should be a no-op: no migration, protocol version unchanged
    await wallet.runtime
      .dispatch({
        [interceptingTag]: (variant) =>
          variant
            .emitProtocolVersionChange(VersionChangeType.Next())
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 99 })))),
      })
      .pipe(Effect.runPromise);

    // State should still be annotated with the original version
    const stateAfter = await rx.firstValueFrom(wallet.rawState.pipe(rx.filter(({ state }) => state === 99)));
    expect(stateAfter).toEqual({ version: ProtocolVersion.MinSupportedVersion, state: 99 });

    // Variant was not migrated — dispatching still reaches the intercepting variant
    const stillSoleVariant = await wallet.runtime
      .dispatch({
        [interceptingTag]: () => Effect.succeed(true),
      })
      .pipe(Effect.runPromise);
    expect(stillSoleVariant).toBe(true);

    await wallet.stop();
  });
});

describe('Variant activation and context', () => {
  const First = 'first' as const;
  const Second = 'second' as const;

  /** Awaits the first state emission matching `predicate` (any emission by default) as an effect. */
  const firstStateWhere = <TState>(
    states: rx.Observable<ProtocolState.ProtocolState<TState>>,
    predicate: (state: ProtocolState.ProtocolState<TState>) => boolean = () => true,
  ): Effect.Effect<ProtocolState.ProtocolState<TState>> =>
    Effect.promise(() => rx.firstValueFrom(states.pipe(rx.filter(predicate))));

  const atVersion =
    (version: ProtocolVersion.ProtocolVersion) =>
    ({ version: emitted }: ProtocolState.ProtocolState<unknown>): boolean =>
      emitted === version;

  const makeTwoVariantWallet = (secondBuilder?: InterceptingVariantBuilder<typeof Second, number>) => {
    const firstBuilder = new InterceptingVariantBuilder<typeof First, number>(First);
    const Wallet = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, firstBuilder)
      .withVariant(
        ProtocolVersion.ProtocolVersion(100n),
        secondBuilder ?? new InterceptingVariantBuilder<typeof Second, number>(Second),
      )
      .build();
    return { Wallet, firstBuilder };
  };

  /** Starts a two-variant wallet, stopping it when the surrounding scope closes. */
  const startTwoVariantWallet = (secondBuilder?: InterceptingVariantBuilder<typeof Second, number>) => {
    const { Wallet } = makeTwoVariantWallet(secondBuilder);
    return Effect.acquireRelease(
      Effect.sync(() => Wallet.startEmpty(Wallet)),
      (wallet) => Effect.promise(() => wallet.stop()),
    );
  };

  it('invokes onVariantActivation exactly once, with the newly activated variant, after a migration', () =>
    Effect.gen(function* () {
      const wallet = yield* startTwoVariantWallet();
      const recorder = yield* makeActivationRecorder(1);

      yield* wallet.runtime.onVariantActivation({
        [First]: () => recorder.record(First),
        [Second]: () => recorder.record(Second),
      });

      // Wait for the first variant to be initiated before driving it
      yield* firstStateWhere(wallet.rawState);

      yield* wallet.runtime.dispatch({
        [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
          ),
        [Second]: () => Effect.void,
      });

      yield* recorder.done;
      // Exactly one activation — for the migration target, never for the initially started variant
      expect(yield* recorder.tags).toEqual([Second]);

      // Sanity: dispatch reaches the migrated-to variant
      const nowSecond = yield* wallet.runtime.dispatch({
        [First]: () => Effect.succeed(false),
        [Second]: () => Effect.succeed(true),
      });
      expect(nowSecond).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('does not invoke onVariantActivation when no migration occurs', () =>
    Effect.gen(function* () {
      const wallet = yield* startTwoVariantWallet();
      const recorder = yield* makeActivationRecorder(1);

      yield* wallet.runtime.onVariantActivation({
        [First]: () => recorder.record(First),
        [Second]: () => recorder.record(Second),
      });

      yield* firstStateWhere(wallet.rawState);

      // Plain state emission — no version change, no migration
      yield* wallet.runtime.dispatch({
        [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
          variant.emit(StateChange.State({ state: 42 })),
        [Second]: () => Effect.void,
      });
      yield* firstStateWhere(wallet.rawState, ({ state }) => state === 42);

      expect(yield* recorder.tags).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('observes every migration of a chain in order, surviving a failing handler', () =>
    Effect.gen(function* () {
      const A = 'a' as const;
      const B = 'b' as const;
      const C = 'c' as const;
      const Wallet = WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, new InterceptingVariantBuilder<typeof A, number>(A))
        .withVariant(ProtocolVersion.ProtocolVersion(50n), new InterceptingVariantBuilder<typeof B, number>(B))
        .withVariant(ProtocolVersion.ProtocolVersion(100n), new InterceptingVariantBuilder<typeof C, number>(C))
        .build();
      const wallet = yield* Effect.acquireRelease(
        Effect.sync(() => Wallet.startEmpty(Wallet)),
        (started) => Effect.promise(() => started.stop()),
      );
      const recorder = yield* makeActivationRecorder(2);

      yield* wallet.runtime.onVariantActivation({
        [A]: () => recorder.record(A),
        // The first activation handler fails AFTER recording — the subscription must survive
        // and still observe the second migration.
        [B]: () =>
          recorder
            .record(B)
            .pipe(Effect.flatMap(() => Effect.fail(new WalletRuntimeError({ message: 'handler boom' })))),
        [C]: () => recorder.record(C),
      });

      yield* firstStateWhere(wallet.rawState);

      yield* wallet.runtime.dispatch({
        [A]: (variant: InterceptingRunningVariant<typeof A, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(50n) }),
          ),
        [B]: () => Effect.void,
        [C]: () => Effect.void,
      });

      // Wait until the second variant is live (its start() re-publishes the migrated state at version 50n)
      yield* firstStateWhere(wallet.rawState, atVersion(ProtocolVersion.ProtocolVersion(50n)));

      yield* wallet.runtime.dispatch({
        [A]: () => Effect.void,
        [B]: (variant: InterceptingRunningVariant<typeof B, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
          ),
        [C]: () => Effect.void,
      });

      yield* recorder.done;
      expect(yield* recorder.tags).toEqual([B, C]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('has the activation subscription live as soon as onVariantActivation resolves', () =>
    Effect.gen(function* () {
      const wallet = yield* startTwoVariantWallet();
      const recorder = yield* makeActivationRecorder(1);

      yield* wallet.runtime.onVariantActivation({
        [First]: () => recorder.record(First),
        [Second]: () => recorder.record(Second),
      });

      // Trigger the migration immediately after registration returns — no other synchronization.
      // If the subscription were established lazily, this activation could be missed.
      yield* wallet.runtime.dispatch({
        [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
          ),
        [Second]: () => Effect.void,
      });

      yield* recorder.done;
      expect(yield* recorder.tags).toEqual([Second]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('passes the activation range derived from registration into each variant start context', () =>
    Effect.gen(function* () {
      const A = 'a' as const;
      const B = 'b' as const;
      const C = 'c' as const;
      const builderA = new InterceptingVariantBuilder<typeof A, number>(A);
      const builderB = new InterceptingVariantBuilder<typeof B, number>(B);
      const builderC = new InterceptingVariantBuilder<typeof C, number>(C);
      const Wallet = WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, builderA)
        .withVariant(ProtocolVersion.ProtocolVersion(50n), builderB)
        .withVariant(ProtocolVersion.ProtocolVersion(100n), builderC)
        .build();
      const wallet = yield* Effect.acquireRelease(
        Effect.sync(() => Wallet.startEmpty(Wallet)),
        (started) => Effect.promise(() => started.stop()),
      );

      yield* firstStateWhere(wallet.rawState);
      yield* wallet.runtime.dispatch({
        [A]: (variant: InterceptingRunningVariant<typeof A, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(50n) }),
          ),
        [B]: () => Effect.void,
        [C]: () => Effect.void,
      });
      yield* firstStateWhere(wallet.rawState, atVersion(ProtocolVersion.ProtocolVersion(50n)));
      yield* wallet.runtime.dispatch({
        [A]: () => Effect.void,
        [B]: (variant: InterceptingRunningVariant<typeof B, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
          ),
        [C]: () => Effect.void,
      });
      yield* firstStateWhere(wallet.rawState, atVersion(ProtocolVersion.ProtocolVersion(100n)));

      // Each variant's half-open range [sinceVersion_N, sinceVersion_N+1) — the last one is
      // open-ended up to MaxSupportedVersion. Derived from registration, delivered via context.
      expect(builderA.built[0]?.receivedContext).toMatchObject({
        activationRange: [ProtocolVersion.MinSupportedVersion, ProtocolVersion.ProtocolVersion(50n)],
      });
      expect(builderB.built[0]?.receivedContext).toMatchObject({
        activationRange: [ProtocolVersion.ProtocolVersion(50n), ProtocolVersion.ProtocolVersion(100n)],
      });
      expect(builderC.built[0]?.receivedContext).toMatchObject({
        activationRange: [ProtocolVersion.ProtocolVersion(100n), ProtocolVersion.MaxSupportedVersion],
      });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('surfaces a migrateState failure as a WalletRuntimeError on the state stream', () =>
    Effect.gen(function* () {
      const failingSecond = new InterceptingVariantBuilder<typeof Second, number>(Second, {
        migrateState: () => Effect.fail(new WalletRuntimeError({ message: 'migration boom' })),
      });
      const wallet = yield* startTwoVariantWallet(failingSecond);

      // Subscribed here, before the migration is triggered, so the terminal failure cannot be missed
      const terminalOutcome = rx.lastValueFrom(wallet.rawState).then(Either.right, Either.left);

      yield* firstStateWhere(wallet.rawState);
      yield* wallet.runtime.dispatch({
        [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
          ),
        [Second]: () => Effect.void,
      });

      const outcome = yield* Effect.promise(() => terminalOutcome);
      expect(Either.isLeft(outcome)).toBe(true);
      expect(Either.getLeft(outcome)).toEqual(Option.some(expect.any(WalletRuntimeError)));
    }).pipe(Effect.scoped, Effect.runPromise));
});
