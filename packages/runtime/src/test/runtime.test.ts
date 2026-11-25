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
import { Cause, Deferred, Duration, Effect, Either, LogLevel, Logger, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StateChange, Variant, VersionChangeType, WalletRuntimeError } from '../abstractions/index.js';
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
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 1 },
      { version: ProtocolVersion.ProtocolVersion(50n), variantTag: interceptingTag, state: 1 }, // This is expected to be emitted by the intercepting variant
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 4 }, // This is the rest
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 6 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 8 },
    ];
    const allCollectedState = toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 8, true)),
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
    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.ProtocolVersion(100n),
      variantTag: NumericMultiplier,
      state: 8,
    });
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
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 43 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 88 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 90 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 92 },
    ];
    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 92, true)),
    );

    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.ProtocolVersion(100n),
      variantTag: NumericMultiplier,
      state: 92,
    });
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
      { version: ProtocolVersion.ProtocolVersion(50n), variantTag: Intercepting, state: 42 }, // this is the state we provided, and runtime automatically emits it
      { version: ProtocolVersion.ProtocolVersion(50n), variantTag: Intercepting, state: 42 }, // the intercepting variant emits it again on start
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 86 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 88 },
    ];
    const allCollectedState = toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 88, true)),
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
    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.ProtocolVersion(100n),
      variantTag: NumericMultiplier,
      state: 88,
    });
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
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 42 }, // The initial state is emitted both by runtime and the variant
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 43 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 88 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 90 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 92 },
    ];
    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 92, true)),
    );

    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.ProtocolVersion(100n),
      variantTag: NumericMultiplier,
      state: 92,
    });
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
    expect(stateAfterVersionChange).toEqual({
      version: ProtocolVersion.ProtocolVersion(50n),
      variantTag: interceptingTag,
      state: 42,
    });

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
    expect(stateAfter).toEqual({
      version: ProtocolVersion.MinSupportedVersion,
      variantTag: interceptingTag,
      state: 99,
    });

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

  /** One log record, reduced to what an assertion about a swallowed watcher failure reads. */
  type CapturedLog = Readonly<{ level: LogLevel.LogLevel; rendered: string }>;

  /**
   * A logger that records what it is handed, and the reading of what it recorded.
   *
   * @remarks
   *   Built outside the effect it is provided to, because what it captures has to outlive that effect: the assertion runs
   *   inside, but the watcher consumer that does the logging is a forked fiber which inherits the loggers of whichever
   *   fiber registered it.
   */
  const capturingLogger = (): Readonly<{
    captured: Effect.Effect<readonly CapturedLog[]>;
    logger: Logger.Logger<unknown, void>;
  }> => {
    const records = Ref.unsafeMake<readonly CapturedLog[]>([]);
    return {
      captured: Ref.get(records),
      logger: Logger.make<unknown, void>(({ logLevel, message, cause }) =>
        Ref.update(records, (entries) => [
          ...entries,
          { level: logLevel, rendered: `${String(message)} ${Cause.pretty(cause)}` },
        ]).pipe(Effect.runSync),
      ),
    };
  };

  it('carries on when a watcher fails, notifying the others on that same activation and logging the failure', () => {
    // Characterization of the swallow at `onVariantActivation` — `Effect.ignoreLogged` — so a future refactor cannot
    // change what it gives us without saying so. Application-visible surfacing of watcher failures is a separate
    // question; what is pinned here is that a failure costs nothing but a debug line.
    const { captured, logger } = capturingLogger();
    return Effect.gen(function* () {
      const wallet = yield* startTwoVariantWallet();
      const recorder = yield* makeActivationRecorder(1);

      // Two watchers on one runtime, registered independently as two callers would register them. The first fails on
      // the activation the second must still see.
      yield* wallet.runtime.onVariantActivation({
        [First]: () => Effect.void,
        [Second]: () => Effect.fail(new WalletRuntimeError({ message: 'watcher boom' })),
      });
      yield* wallet.runtime.onVariantActivation({
        [First]: () => recorder.record(First),
        [Second]: () => recorder.record(Second),
      });

      yield* firstStateWhere(wallet.rawState);
      yield* wallet.runtime.dispatch({
        [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
          ),
        [Second]: () => Effect.void,
      });

      // The surviving watcher observed the very activation the other one failed on.
      yield* recorder.done;
      expect(yield* recorder.tags).toEqual([Second]);

      // And the runtime is unharmed: it dispatches to the variant that was activated, and its state still flows.
      const nowSecond = yield* wallet.runtime.dispatch({
        [First]: () => Effect.succeed(false),
        [Second]: () => Effect.succeed(true),
      });
      expect(nowSecond).toBe(true);
      yield* wallet.runtime.dispatch({
        [First]: () => Effect.void,
        [Second]: (variant: InterceptingRunningVariant<typeof Second, number>) =>
          variant.emit(StateChange.State({ state: 7 })),
      });
      yield* firstStateWhere(wallet.rawState, ({ state }) => state === 7);

      // Swallowed, but not silently: the cause is logged once, at debug level, which is the whole of what a failing
      // watcher leaves behind today.
      expect((yield* captured).filter((entry) => entry.rendered.includes('watcher boom'))).toEqual([
        expect.objectContaining({ level: LogLevel.Debug }),
      ]);
    }).pipe(
      Effect.scoped,
      Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.runPromise,
    );
  });

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

  it('should hand every variant the same runtime scope, which outlives a hand-over and closes when the wallet stops, so work a variant forks into it is neither cut short nor leaked', () =>
    Effect.gen(function* () {
      const firstBuilder = new InterceptingVariantBuilder<typeof First, number>(First);
      const secondBuilder = new InterceptingVariantBuilder<typeof Second, number>(Second);
      const Wallet = WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, firstBuilder)
        .withVariant(ProtocolVersion.ProtocolVersion(100n), secondBuilder)
        .build();
      const wallet = Wallet.startEmpty(Wallet);
      yield* Effect.addFinalizer(() => Effect.promise(() => wallet.stop()));

      /**
       * Forks work that runs until interrupted into `scope`, once it is running, and returns a signal completed when it
       * is interrupted. Waiting for it to run matters: a fiber interrupted before it starts runs none of its handlers.
       */
      const forkUntilInterrupted = (scope: Scope.Scope) =>
        Effect.gen(function* () {
          const running = yield* Deferred.make<void>();
          const interrupted = yield* Deferred.make<void>();
          yield* Effect.forkIn(
            Deferred.succeed(running, undefined).pipe(
              Effect.zipRight(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
            scope,
          );
          yield* Deferred.await(running);
          return interrupted;
        });

      /** The runtime scope the builder's first variant was started with; a missing one fails the test. */
      const runtimeScopeOf = (builder: {
        built: readonly { receivedContext: { runtimeScope?: Scope.Scope } | undefined }[];
      }) => Effect.orDie(Effect.fromNullable(builder.built[0]?.receivedContext?.runtimeScope));

      yield* firstStateWhere(wallet.rawState);
      const firstScope = yield* runtimeScopeOf(firstBuilder);
      const firstWork = yield* forkUntilInterrupted(firstScope);

      yield* wallet.runtime.dispatch({
        [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
          variant.emitProtocolVersionChange(
            VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
          ),
        [Second]: () => Effect.void,
      });
      yield* firstStateWhere(wallet.rawState, atVersion(ProtocolVersion.ProtocolVersion(100n)));
      const secondScope = yield* runtimeScopeOf(secondBuilder);
      const secondWork = yield* forkUntilInterrupted(secondScope);

      expect(secondScope).toBe(firstScope);
      // The first variant's scope has closed with the hand-over; the work it forked into the runtime scope has not.
      expect(yield* Deferred.isDone(firstWork)).toBe(false);

      yield* Effect.promise(() => wallet.stop());

      yield* Deferred.await(firstWork).pipe(Effect.timeout('2 seconds'));
      yield* Deferred.await(secondWork).pipe(Effect.timeout('2 seconds'));
    }).pipe(Effect.scoped, Effect.runPromise));

  describe('work a variant runs beyond itself, when the wallet stops', () => {
    /**
     * Every line written to the console for the rest of the scope, while the console itself stays quiet.
     *
     * @remarks
     *   A wallet stops on Effect's default runtime, so what it logs while stopping reaches only the global console, not a
     *   logger the test could provide. The array is mutated by the spies: it is test scaffolding, released with the
     *   scope.
     */
    const capturedConsole: Effect.Effect<readonly string[], never, Scope.Scope> = Effect.acquireRelease(
      Effect.sync(() => {
        const lines: string[] = [];
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
          }),
        );
        return { lines, spies };
      }),
      ({ spies }) => Effect.sync(() => spies.forEach((spy) => spy.mockRestore())),
    ).pipe(Effect.map(({ lines }) => lines));

    /** The runner the builder's variant at `index` was started with; a missing one fails the test. */
    const runnerOf = <TTag extends string | symbol>(builder: InterceptingVariantBuilder<TTag, number>, index = 0) =>
      Effect.orDie(Effect.fromNullable(builder.built[index]?.receivedContext?.runBeyondVariant));

    /** Work that runs until interrupted, once it is running, and a signal completed when it is interrupted. */
    const runUntilInterrupted = (run: (work: Effect.Effect<void>) => Effect.Effect<void>) =>
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        yield* run(
          Deferred.succeed(running, undefined).pipe(
            Effect.zipRight(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        );
        yield* Deferred.await(running);
        return interrupted;
      });

    it('should let work that finishes within the grace finish, because it may be the only record of changes already applied', () =>
      Effect.gen(function* () {
        const { Wallet, firstBuilder } = makeTwoVariantWallet();
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        const release = yield* Deferred.make<void>();
        const finished = yield* Deferred.make<void>();

        yield* (yield* runnerOf(firstBuilder))(
          Deferred.await(release).pipe(Effect.zipRight(Deferred.succeed(finished, undefined))),
        );
        yield* Deferred.succeed(release, undefined).pipe(Effect.delay('300 millis'), Effect.forkDaemon);
        yield* Effect.promise(() => wallet.stop());

        expect(yield* Deferred.isDone(finished)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise));

    it('should interrupt the work of every variant still running after one grace, because the grace is the wallet’s, not each variant’s', () =>
      Effect.gen(function* () {
        const secondBuilder = new InterceptingVariantBuilder<typeof Second, number>(Second);
        const { Wallet, firstBuilder } = makeTwoVariantWallet(secondBuilder);
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        const firstWork = yield* runUntilInterrupted(yield* runnerOf(firstBuilder));

        yield* wallet.runtime.dispatch({
          [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
            variant.emitProtocolVersionChange(
              VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
            ),
          [Second]: () => Effect.void,
        });
        yield* firstStateWhere(wallet.rawState, atVersion(ProtocolVersion.ProtocolVersion(100n)));
        // The premise: work run by the first variant outlives its hand-over.
        expect(yield* Deferred.isDone(firstWork)).toBe(false);
        const secondWork = yield* runUntilInterrupted(yield* runnerOf(secondBuilder));

        const stopped = yield* Effect.promise(() => wallet.stop()).pipe(
          Effect.timeoutOption(Duration.sum(Variant.BACKGROUND_WORK_GRACE, Duration.millis(500))),
        );

        expect(Option.isSome(stopped)).toBe(true);
        expect(yield* Deferred.isDone(firstWork)).toBe(true);
        expect(yield* Deferred.isDone(secondWork)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise));

    it('should start the grace only once the running variant has stopped, because a variant still running could go on starting work', () =>
      Effect.gen(function* () {
        const variantStopped = yield* Deferred.make<void>();
        const firstBuilder = new InterceptingVariantBuilder<typeof First, number>(First, {
          onStop: Deferred.succeed(variantStopped, undefined),
        });
        const Wallet = WalletBuilder.init().withVariant(ProtocolVersion.MinSupportedVersion, firstBuilder).build();
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        const finished = yield* Deferred.make<void>();

        // Work that can finish only once the variant has stopped: had the grace begun first, it would wait it out.
        yield* (yield* runnerOf(firstBuilder))(
          Deferred.await(variantStopped).pipe(Effect.zipRight(Deferred.succeed(finished, undefined))),
        );
        const stopped = yield* Effect.promise(() => wallet.stop()).pipe(
          Effect.timeoutOption(Duration.divide(Variant.BACKGROUND_WORK_GRACE, 2).pipe(Option.getOrThrow)),
        );

        expect(Option.isSome(stopped)).toBe(true);
        expect(yield* Deferred.isDone(finished)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise));

    /** Hands the wallet over from the first variant to the second, and waits until it has. */
    const handOverToSecond = (wallet: Effect.Effect.Success<ReturnType<typeof startTwoVariantWallet>>) =>
      wallet.runtime
        .dispatch({
          [First]: (variant: InterceptingRunningVariant<typeof First, number>) =>
            variant.emitProtocolVersionChange(
              VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }),
            ),
          [Second]: () => Effect.void,
        })
        .pipe(Effect.zipRight(firstStateWhere(wallet.rawState, atVersion(ProtocolVersion.ProtocolVersion(100n)))));

    it('should give work a grace of one second, because that is the bound the wallet documents for stop()', () => {
      expect(Duration.toMillis(Variant.BACKGROUND_WORK_GRACE)).toBe(1000);
    });

    it('should let work that finishes just inside the grace finish, because the whole grace is given, not part of it', () =>
      Effect.gen(function* () {
        const { Wallet, firstBuilder } = makeTwoVariantWallet();
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        const release = yield* Deferred.make<void>();
        const finished = yield* Deferred.make<void>();

        yield* (yield* runnerOf(firstBuilder))(
          Deferred.await(release).pipe(Effect.zipRight(Deferred.succeed(finished, undefined))),
        );
        yield* Deferred.succeed(release, undefined).pipe(
          Effect.delay(Duration.subtract(Variant.BACKGROUND_WORK_GRACE, Duration.millis(150))),
          Effect.forkDaemon,
        );
        yield* Effect.promise(() => wallet.stop());

        expect(yield* Deferred.isDone(finished)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise));

    it('should interrupt work as soon as the grace runs out, because the grace bounds the stop, not only the work', () =>
      Effect.gen(function* () {
        const { Wallet, firstBuilder } = makeTwoVariantWallet();
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        const work = yield* runUntilInterrupted(yield* runnerOf(firstBuilder));

        const [elapsed] = yield* Effect.timed(Effect.promise(() => wallet.stop()));

        expect(yield* Deferred.isDone(work)).toBe(true);
        expect(Duration.toMillis(elapsed)).toBeGreaterThanOrEqual(Duration.toMillis(Variant.BACKGROUND_WORK_GRACE));
        // A margin for tearing the wallet down, well short of what a longer grace would add.
        expect(Duration.toMillis(elapsed)).toBeLessThan(Duration.toMillis(Variant.BACKGROUND_WORK_GRACE) + 200);
      }).pipe(Effect.scoped, Effect.runPromise));

    it('should run the work of a variant started at a hand-over beyond it too, because that variant records its own changes', () =>
      Effect.gen(function* () {
        const secondBuilder = new InterceptingVariantBuilder<typeof Second, number>(Second);
        const { Wallet } = makeTwoVariantWallet(secondBuilder);
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        yield* handOverToSecond(wallet);
        const release = yield* Deferred.make<void>();
        const finished = yield* Deferred.make<void>();

        yield* (yield* runnerOf(secondBuilder))(
          Deferred.await(release).pipe(Effect.zipRight(Deferred.succeed(finished, undefined))),
        );
        yield* Deferred.succeed(release, undefined).pipe(Effect.delay('300 millis'), Effect.forkDaemon);
        yield* Effect.promise(() => wallet.stop());

        expect(yield* Deferred.isDone(finished)).toBe(true);
      }).pipe(Effect.scoped, Effect.runPromise));

    it('should resolve every stop() called while the wallet is stopping only once it has stopped, because a caller acts on the stop being done', () =>
      Effect.gen(function* () {
        const { Wallet, firstBuilder } = makeTwoVariantWallet();
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        const release = yield* Deferred.make<void>();
        const finished = yield* Deferred.make<void>();

        yield* (yield* runnerOf(firstBuilder))(
          Deferred.await(release).pipe(Effect.zipRight(Deferred.succeed(finished, undefined))),
        );
        yield* Deferred.succeed(release, undefined).pipe(Effect.delay('300 millis'), Effect.forkDaemon);
        // Two callers stop the same wallet at once, as a facade stopping every wallet and an application might.
        const finishedWhenEachResolved = yield* Effect.promise(() =>
          Promise.all(
            [wallet.stop(), wallet.stop()].map((stopping) =>
              stopping.then(() => Deferred.isDone(finished).pipe(Effect.runSync)),
            ),
          ),
        );

        expect(finishedWhenEachResolved).toEqual([true, true]);
      }).pipe(Effect.scoped, Effect.runPromise));

    it('should warn when the grace runs out with work still running, because work cut off may leave no trace of its own', () =>
      Effect.gen(function* () {
        const lines = yield* capturedConsole;
        const { Wallet, firstBuilder } = makeTwoVariantWallet();
        const wallet = Wallet.startEmpty(Wallet);
        yield* firstStateWhere(wallet.rawState);
        const work = yield* runUntilInterrupted(yield* runnerOf(firstBuilder));

        yield* Effect.promise(() => wallet.stop());

        expect(yield* Deferred.isDone(work)).toBe(true);
        expect(lines.filter((line) => /level=WARN/.test(line) && /grace/.test(line))).toEqual([
          expect.stringMatching(/\b1\b/),
        ]);
      }).pipe(Effect.scoped, Effect.runPromise));

    it('should log a defect in work it runs, because nothing else waits on that work to report it', () =>
      Effect.gen(function* () {
        const lines = yield* capturedConsole;
        const { Wallet, firstBuilder } = makeTwoVariantWallet();
        const wallet = Wallet.startEmpty(Wallet);
        yield* Effect.addFinalizer(() => Effect.promise(() => wallet.stop()));
        yield* firstStateWhere(wallet.rawState);

        yield* (yield* runnerOf(firstBuilder))(Effect.die(new Error('background boom')));
        yield* Effect.sleep('50 millis');

        expect(lines.filter((line) => /level=ERROR/.test(line) && /background boom/.test(line))).toHaveLength(1);
      }).pipe(Effect.scoped, Effect.runPromise));
  });

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
