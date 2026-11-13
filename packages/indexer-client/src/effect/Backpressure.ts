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
//
// Bounded backpressure over a push-only source whose only knob is "dispose and
// re-open from a cursor". The classic shape for graphql-ws / SSE-style feeds
// that don't support pull or pause signalling.
//
// Composition:
//   - Pure state machine (decideItem/decideTerminate/decideComplete/decideResume,
//     and noteActivity/decideStall for stall detection) contains all transition
//     rules and is unit-testable in isolation.
//   - `withBackpressure` wires the state machine to a {@link Source}, an
//     internal Stream.asyncPush queue, and a Stream.tap drain detector.
//   - Source authors translate their callbacks to the {@link Source} contract
//     once; backpressure is independent of the underlying transport.
import { Clock, Data, Duration, Effect, Either, Option, type Scope, Stream, type StreamEmit, Ref } from 'effect';

// ============================================================================
// Public types
// ============================================================================

/**
 * Options controlling the bounded backpressure behavior.
 *
 * The implementation caps the number of in-flight (emitted but not yet consumed downstream) items. Once
 * {@link bufferSize} is reached the underlying source is disposed; when the consumer drains back down to
 * {@link resumeThreshold} a fresh subscription is opened with `variables(cursor)` for the running cursor.
 *
 * Emitted items are guaranteed strictly monotonic by {@link key}. Dedup uses a single exclusive watermark: any item with
 * a key `<= watermark` is dropped, and each emitted key advances the watermark. The watermark seeds from {@link from},
 * so the item _at_ `from` is treated as already-seen and dropped. This is what makes resume safe over an inclusive
 * cursor: the boundary item a resume re-delivers has a key equal to the watermark and is dropped — without it, the
 * first item after a resume would duplicate the last one emitted before the pause. A caller that needs the item at its
 * logical cursor emitted (e.g. to let an already-caught-up consumer observe its tip) passes `from` one below that
 * cursor.
 *
 * The cursor is the single source of truth for both initial open and resume — no separate "initial variables" field;
 * `variables(from)` opens the first subscription, `variables(key(lastItem))` opens every subsequent one.
 *
 * No items above the watermark are dropped — the producer is paused, never thrown away.
 *
 * **Totality contract:** {@link key} and {@link variables} MUST be total — they must not throw for any input of their
 * declared types. The wrapper does not catch exceptions from these closures: a throw from `key` propagates back through
 * the source's sync callback (undefined behavior depending on the source's internals), and a throw from `variables`
 * surfaces as an unhandled defect on the resulting `Stream` rather than a typed `E`. The signatures `(cursor: bigint)
 * => V` and `(item: Item) => bigint` are the contract; honor them.
 */
export interface BackpressureOptions<Item, V> {
  /** Pause the underlying subscription once in-flight reaches this count. */
  readonly bufferSize: number;
  /**
   * Resume once in-flight drains back to this count. Must be strictly less than `bufferSize` to give the consumer real
   * hysteresis.
   */
  readonly resumeThreshold: number;
  /** Initial cursor (bigint watermark). The first subscription opens with `variables(from)`. */
  readonly from: bigint;
  /** Derives subscription variables from a cursor. Used for the initial open and on every resume. */
  readonly variables: (cursor: bigint) => V;
  /** Monotonic key extractor — items with a key not strictly greater than the running watermark are dropped. */
  readonly key: (result: Item) => bigint;
  /**
   * Fails the stream when an open session that is behind delivers nothing for {@link STALL_TIMEOUT}. A session is behind
   * when the tip is above the last key delivered, the tip being what the latest item reported through
   * {@link StallDetection.tip}, or {@link StallDetection.knownTip} until an item has reported one. A session at the tip,
   * one with no tip known, and one paused for backpressure are left alone. Omitted, a silent session is waited on for
   * as long as it stays open.
   */
  readonly stall?: StallDetection<Item>;
}

/**
 * How a session that has stopped delivering is told apart from one with nothing left to deliver.
 *
 * A push-only source gives no sign of life between items, so a session that stays open and goes quiet looks the same
 * whether the source has died or has reached its end. The tip tells them apart: a tip above the last key delivered
 * proves there is more to deliver. Like {@link BackpressureOptions.key}, {@link tip} must be total.
 */
export interface StallDetection<Item> {
  /** The highest key the source reports to exist, read off an item. */
  readonly tip: (item: Item) => bigint;
  /**
   * The highest key already known to exist when the stream opens, as an earlier stream's items reported it. Without it
   * a session that is dead from its first frame reports no tip of its own and is never given up on. It stands only
   * until an item reports a tip, which then replaces it. Left out by a caller that has seen no tip.
   */
  readonly knownTip?: bigint;
}

/** How long an open session that is behind may deliver nothing before it is given up on. */
export const STALL_TIMEOUT = Duration.seconds(30);

/**
 * An open session that was behind delivered nothing for {@link STALL_TIMEOUT}.
 *
 * The source raised nothing itself: a session it stops writing to while the connection stays open neither ends nor
 * fails. This is the failure the wrapper raises in its place, which gives whatever retries the stream its chance to.
 */
export class SubscriptionStalledError extends Data.TaggedError('SubscriptionStalledError')<{
  /** The last key delivered, or the cursor the stream opened at when nothing was. */
  readonly lastKey: bigint;
  /** How far the source was known to go. */
  readonly tip: bigint;
}> {}

/**
 * A push-based source. Each call opens a fresh session and returns a dispose handle. Items, errors and completion flow
 * through the supplied callbacks.
 *
 * The source MUST stop delivering callbacks after `dispose()` is invoked. The caller pauses by disposing and resumes by
 * calling the factory again with new variables; the source has no other backpressure signalling.
 */
export type Source<Item, V, E> = (params: {
  readonly variables: V;
  readonly onItem: (item: Item) => void;
  readonly onError: (error: E) => void;
  readonly onComplete: () => void;
}) => () => void;

// ============================================================================
// State machine (pure)
//
// Lifecycle of a backpressure-aware subscription:
//   1. open source → items flow into the Stream.asyncPush queue
//   2. queue reaches bufferSize → dispose source, set paused=true
//   3. consumer drains to resumeThreshold → bump generation, re-open source
//      with variables(lastKey)
//
// `generation` identifies the active (re-)subscription. Late callbacks from a
// disposed source are ignored by comparing against the current generation —
// that prevents a delayed `onComplete` from a paused-out session from
// terminating the consumer-visible stream.
//
// `lastKey` is the strictly-monotonic emission watermark. The source's resume
// cursor is inclusive (by assumption), so the boundary item gets re-delivered
// after each resume; the dedup here filters it. It is also the sole input to
// `variables(...)` when (re-)opening a session — no cached variables in state.
//
// `tip` and `lastActivity` are what stall detection reads. A session is behind
// while `tip` is above `lastKey`, and silent since `lastActivity`, which moves
// whenever the open session opens or delivers and names the session it is
// about: a resume bumps the generation before the new session opens, and the
// silence of the pause it ends must not be read as the new session's. Both
// live in this one state so the decision to give up on a session is taken
// against a consistent view.
// ============================================================================

/** @internal — exported only for unit tests; not part of the public API. */
export type BPState = {
  readonly paused: boolean;
  readonly inFlight: number;
  readonly lastKey: bigint;
  readonly generation: number;
  readonly terminal: boolean;
  /** How far the source is known to go: what the latest item reported, or the caller's seed until one has. */
  readonly tip: Option.Option<bigint>;
  /** When a session last showed life, by opening or delivering, and which session that was. None until one has. */
  readonly lastActivity: Option.Option<SessionActivity>;
};

/** @internal A sign of life from the session of one generation, at a time in clock millis. */
export type SessionActivity = { readonly generation: number; readonly at: number };

/** @internal */
export type ItemDecision = { readonly emit: boolean; readonly pause: boolean };

/** @internal */
export const initialBPState = (from: bigint, knownTip?: bigint): BPState => ({
  paused: false,
  inFlight: 0,
  lastKey: from,
  generation: 0,
  terminal: false,
  tip: Option.fromNullable(knownTip),
  lastActivity: Option.none(),
});

/**
 * @internal Decide what to do with an item arriving on `onItem`.
 *
 * The watermark is exclusive throughout: an item is dropped iff its key is `<= lastKey`, and each emitted key advances
 * the watermark. The watermark seeds from `from`, so the item at `from` itself is treated as already-seen and dropped —
 * a caller that wants the item at its logical cursor emitted seeds `from` one below it. The same exclusive rule drops
 * the boundary item an inclusive-cursor resume re-delivers (its key equals `lastKey`).
 */
export const decideItem = (
  s: BPState,
  k: bigint,
  myGen: number,
  bufferSize: number,
): readonly [ItemDecision, BPState] => {
  if (s.terminal || s.generation !== myGen) return [{ emit: false, pause: false }, s];
  if (k <= s.lastKey) return [{ emit: false, pause: false }, s];
  const inFlight = s.inFlight + 1;
  const pause = inFlight >= bufferSize && !s.paused;
  return [
    { emit: true, pause },
    { ...s, inFlight, lastKey: k, paused: s.paused || pause },
  ];
};

/** @internal Decide whether an error callback should surface (false for stale/terminal). */
export const decideTerminate = (s: BPState, myGen: number): readonly [boolean, BPState] =>
  s.terminal || s.generation !== myGen ? [false, s] : [true, { ...s, terminal: true }];

/** @internal Decide whether a completion is consumer-visible end-of-stream or dispose-induced. */
export const decideComplete = (s: BPState, myGen: number): readonly [boolean, BPState] => {
  if (s.paused || s.terminal || s.generation !== myGen) return [false, s];
  return [true, { ...s, terminal: true }];
};

/**
 * @internal Decide whether to resume the source after a downstream consume. Paused implies we've emitted at least
 * bufferSize items, so lastKey is meaningful. Returns true when the caller should open a new session — the caller
 * derives the resume variables from `state.lastKey` itself.
 */
export const decideResume = (s: BPState, resumeThreshold: number): readonly [boolean, BPState] => {
  if (s.terminal) return [false, s];
  const inFlight = Math.max(0, s.inFlight - 1);
  if (s.paused && inFlight <= resumeThreshold) {
    return [true, { ...s, inFlight, paused: false, generation: s.generation + 1 }];
  }
  return [false, { ...s, inFlight }];
};

/** @internal What {@link decideStall} decides: the stall, or how many millis until it is worth looking again. */
export type StallDecision = Either.Either<number, SubscriptionStalledError>;

/**
 * @internal Record that the open session showed life at `now`: it opened, or delivered an item reporting `tip`.
 *
 * Every item counts, including one the watermark goes on to drop: a boundary item re-delivered after a resume says
 * nothing new, but it proves the session is alive and carries the freshest tip. A reported tip replaces the one held,
 * even a higher one: the tip a caller seeded is what an earlier stream saw, and a source that now reports less, as one
 * still rebuilding its history does, owes this session no more than it says it has. Callbacks from a session that is
 * no longer the open one are ignored, as everywhere else.
 */
export const noteActivity = (s: BPState, myGen: number, now: number, tip: Option.Option<bigint>): BPState =>
  s.terminal || s.generation !== myGen
    ? s
    : {
        ...s,
        lastActivity: Option.some({ generation: myGen, at: now }),
        tip: Option.orElse(tip, () => s.tip),
      };

/**
 * @internal Decide whether the open session has stalled: it is behind how far the source is known to go and has been
 * silent for `timeoutMillis`.
 *
 * Three kinds of session cannot stall. A paused one is the wrapper's own silence. One with no tip above its last key has
 * nothing owed to it. One that has not shown life yet, because a resume has named it and it is still to open, has no
 * silence of its own to measure. Each is looked at again a full timeout later, which is never too late: a session only
 * becomes one that can stall by opening or delivering, and either moves `lastActivity` to that moment.
 */
export const decideStall = (s: BPState, now: number, timeoutMillis: number): readonly [StallDecision, BPState] => {
  const owed =
    s.terminal || s.paused
      ? Option.none()
      : Option.all({
          tip: Option.filter(s.tip, (tip) => tip > s.lastKey),
          aliveAt: Option.map(
            Option.filter(s.lastActivity, ({ generation }) => generation === s.generation),
            ({ at }) => at,
          ),
        });
  return Option.match(owed, {
    onNone: (): readonly [StallDecision, BPState] => [Either.right(timeoutMillis), s],
    onSome: ({ tip, aliveAt }): readonly [StallDecision, BPState] => {
      const remaining = aliveAt + timeoutMillis - now;
      return remaining > 0
        ? [Either.right(remaining), s]
        : [Either.left(new SubscriptionStalledError({ lastKey: s.lastKey, tip })), { ...s, terminal: true }];
    },
  });
};

// ============================================================================
// Stream wrapper
// ============================================================================

/**
 * Wrap a push-based {@link Source} with bounded backpressure. The source is paused (disposed) when the in-flight count
 * reaches `bufferSize` and resumed (re-opened with `variables(lastKey)`) once the consumer drains back to
 * `resumeThreshold`.
 *
 * With {@link BackpressureOptions.stall}, an open session that is behind and delivers nothing for {@link STALL_TIMEOUT}
 * is closed and the stream fails with a {@link SubscriptionStalledError}, after everything the session did deliver.
 *
 * See {@link BackpressureOptions} for the monotonic-key dedup invariant.
 */
export const withBackpressure = <Item, V, E>(
  source: Source<Item, V, E>,
  options: BackpressureOptions<Item, V>,
): Stream.Stream<Item, E | SubscriptionStalledError> => {
  type Emit = StreamEmit.EmitOpsPush<E | SubscriptionStalledError, Item>;

  const { bufferSize, resumeThreshold, key, from, variables, stall } = options;
  const stallTimeoutMillis = Duration.toMillis(STALL_TIMEOUT);
  const tipOf = (item: Item): Option.Option<bigint> => Option.map(Option.fromNullable(stall), ({ tip }) => tip(item));

  // Stream.unwrap re-runs the factory per subscription, so each consumer of
  // the returned Stream gets its own Refs and its own source session.
  return Stream.unwrap(
    Effect.gen(function* () {
      // Three refs cover the inherently mutable bridge between sync source
      // callbacks and Effect: the state machine, the current dispose handle,
      // and the asyncPush emit handle (only bound while a consumer is
      // attached).
      // Read by the source's sync callbacks, which run outside any fiber and so cannot ask for the time as an effect.
      const clock = yield* Effect.clock;
      const stateRef = yield* Ref.make<BPState>(initialBPState(from, stall?.knownTip));
      const disposerRef = yield* Ref.make<(() => void) | null>(null);
      const emitRef = yield* Ref.make<Emit | null>(null);

      // Source callbacks are sync JS. Ref ops are sync internally, so runSync
      // is safe here. Confined to these two helpers for auditability.
      const modify = <A>(f: (s: BPState) => readonly [A, BPState]): A => Effect.runSync(Ref.modify(stateRef, f));
      const takeDisposer = (): (() => void) | null => Effect.runSync(Ref.getAndSet(disposerRef, null));

      const openSession = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          // A session shows life by opening, so the silence that counts starts here and not at whatever preceded a
          // pause.
          const state = yield* Ref.updateAndGet(stateRef, (s) => noteActivity(s, s.generation, now, Option.none()));
          if (state.terminal) return;
          const emit = yield* Ref.get(emitRef);
          if (emit === null) return;
          const myGen = state.generation;

          const dispose = source({
            variables: variables(state.lastKey),
            onItem: (item) => {
              const now = clock.unsafeCurrentTimeMillis();
              const action = modify((s) =>
                decideItem(noteActivity(s, myGen, now, tipOf(item)), key(item), myGen, bufferSize),
              );
              if (!action.emit) return;
              emit.single(item);
              if (action.pause) takeDisposer()?.();
            },
            onError: (error) => {
              if (modify((s) => decideTerminate(s, myGen))) emit.fail(error);
            },
            onComplete: () => {
              if (modify((s) => decideComplete(s, myGen))) emit.end();
            },
          });
          yield* Ref.set(disposerRef, dispose);
        });

      // One look at whether the open session has stalled: either it has, and the session is closed and the stream
      // failed, or the fiber sleeps until it is worth looking again. Answers whether it gave up.
      const checkForStall = (emit: Emit): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const decision = yield* Ref.modify(stateRef, (s) => decideStall(s, now, stallTimeoutMillis));
          return yield* Either.match(decision, {
            onRight: (millis) => Effect.as(Effect.sleep(Duration.millis(millis)), false),
            onLeft: (stalled) =>
              Ref.getAndSet(disposerRef, null).pipe(
                Effect.tap((dispose) =>
                  Effect.sync(() => {
                    dispose?.();
                    emit.fail(stalled);
                  }),
                ),
                Effect.as(true),
              ),
          });
        });

      // Scoped to the stream, so the watch ends with it however it ends. Not forked at all without stall detection:
      // there is then no tip to be behind, and nothing to watch for.
      const watchForStall = (emit: Emit): Effect.Effect<void, never, Scope.Scope> =>
        stall === undefined
          ? Effect.void
          : Effect.asVoid(Effect.forkScoped(Effect.repeat(checkForStall(emit), { until: (gaveUp) => gaveUp })));

      return Stream.asyncPush<Item, E | SubscriptionStalledError>(
        (emit) =>
          Effect.acquireRelease(
            Effect.gen(function* () {
              yield* Ref.set(emitRef, emit);
              yield* openSession();
            }),
            () =>
              Effect.gen(function* () {
                yield* Ref.update(stateRef, (s) => ({ ...s, terminal: true }));
                const d = yield* Ref.getAndSet(disposerRef, null);
                if (d !== null) yield* Effect.sync(() => d());
                yield* Ref.set(emitRef, null);
              }),
          ).pipe(Effect.zipRight(watchForStall(emit))),
        { bufferSize: 'unbounded' },
      ).pipe(
        Stream.tap(() =>
          Effect.gen(function* () {
            const shouldResume = yield* Ref.modify(stateRef, (s) => decideResume(s, resumeThreshold));
            if (shouldResume) yield* openSession();
          }),
        ),
      );
    }),
  );
};
