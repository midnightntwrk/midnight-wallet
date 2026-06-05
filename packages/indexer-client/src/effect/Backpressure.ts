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
//   - Pure state machine (decideItem/decideTerminate/decideComplete/decideResume)
//     contains all transition rules and is unit-testable in isolation.
//   - `withBackpressure` wires the state machine to a {@link Source}, an
//     internal Stream.asyncPush queue, and a Stream.tap drain detector.
//   - Source authors translate their callbacks to the {@link Source} contract
//     once; backpressure is independent of the underlying transport.
import { Effect, Stream, type StreamEmit, Ref } from 'effect';

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
 * Emitted items are guaranteed strictly monotonic by {@link key}: anything with a key `<= from` (initially) or `<=
 * last-emitted key` is dropped silently. That is what makes this safe over sources with an inclusive resume cursor —
 * without it, the first item after a resume duplicates the last one emitted before the pause.
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
}

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
// ============================================================================

/** @internal — exported only for unit tests; not part of the public API. */
export type BPState = {
  readonly paused: boolean;
  readonly inFlight: number;
  readonly lastKey: bigint;
  readonly generation: number;
  readonly terminal: boolean;
};

/** @internal */
export type ItemDecision = { readonly emit: boolean; readonly pause: boolean };

/** @internal */
export const initialBPState = (from: bigint): BPState => ({
  paused: false,
  inFlight: 0,
  lastKey: from,
  generation: 0,
  terminal: false,
});

/** @internal Decide what to do with an item arriving on `onItem`. */
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

// ============================================================================
// Stream wrapper
// ============================================================================

/**
 * Wrap a push-based {@link Source} with bounded backpressure. The source is paused (disposed) when the in-flight count
 * reaches `bufferSize` and resumed (re-opened with `variables(lastKey)`) once the consumer drains back to
 * `resumeThreshold`.
 *
 * See {@link BackpressureOptions} for the monotonic-key dedup invariant.
 */
export const withBackpressure = <Item, V, E>(
  source: Source<Item, V, E>,
  options: BackpressureOptions<Item, V>,
): Stream.Stream<Item, E> => {
  type Emit = StreamEmit.EmitOpsPush<E, Item>;

  const { bufferSize, resumeThreshold, key, from, variables } = options;

  // Stream.unwrap re-runs the factory per subscription, so each consumer of
  // the returned Stream gets its own Refs and its own source session.
  return Stream.unwrap(
    Effect.gen(function* () {
      // Three refs cover the inherently mutable bridge between sync source
      // callbacks and Effect: the state machine, the current dispose handle,
      // and the asyncPush emit handle (only bound while a consumer is
      // attached).
      const stateRef = yield* Ref.make<BPState>(initialBPState(from));
      const disposerRef = yield* Ref.make<(() => void) | null>(null);
      const emitRef = yield* Ref.make<Emit | null>(null);

      // Source callbacks are sync JS. Ref ops are sync internally, so runSync
      // is safe here. Confined to these two helpers for auditability.
      const modify = <A>(f: (s: BPState) => readonly [A, BPState]): A => Effect.runSync(Ref.modify(stateRef, f));
      const takeDisposer = (): (() => void) | null => Effect.runSync(Ref.getAndSet(disposerRef, null));

      const openSession = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (state.terminal) return;
          const emit = yield* Ref.get(emitRef);
          if (emit === null) return;
          const myGen = state.generation;

          const dispose = source({
            variables: variables(state.lastKey),
            onItem: (item) => {
              const action = modify((s) => decideItem(s, key(item), myGen, bufferSize));
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

      return Stream.asyncPush<Item, E>(
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
          ),
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
