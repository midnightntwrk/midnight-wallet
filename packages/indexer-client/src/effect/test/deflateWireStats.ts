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

/**
 * Test kit for the WebSocket deflate-compression integration tests: a counting WebSocket that observes raw frames below
 * the deflate wrapper, the wire-savings measure the tests assert on, and a human-readable report of the same numbers so
 * a run's actual savings stay visible in the test output.
 */
import { strFromU8, unzlibSync } from 'fflate';
import { type TestContext } from 'vitest';

/** Per-frame wire observation, taken below the deflate wrapper (i.e. before any inflation). */
export interface Frame {
  readonly binary: boolean;
  /** Bytes on the wire. */
  readonly wire: number;
  /** Bytes after inflation (equal to `wire` for text frames). */
  readonly inflated: number;
  /** The graphql-transport-ws message type (`connection_ack`, `next`, `complete`, ...). */
  readonly type: string;
}

export interface WireStats {
  readonly frames: Frame[];
  protocol: string;
  /** Number of physical WebSocket connections constructed. */
  sockets: number;
}

export const emptyWireStats = (): WireStats => ({ frames: [], protocol: '', sockets: 0 });

const messageType = (json: string): string => {
  try {
    // Type cast required because: JSON.parse returns `any`; the ?? fallback below covers a
    // missing/non-string field, which is the only shape risk that matters here.
    return ((JSON.parse(json) as { type?: string }).type ?? 'unknown') || 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * Records every frame as it arrives on the underlying socket, accumulating into `stats`. Observation only
 * (`addEventListener`), so the deflate wrapper's `onmessage` interception is unaffected.
 *
 * Mutation of `stats` is deliberate and the reason `WireStats` has mutable fields: frames arrive one event at a time
 * over the life of a connection, so there is no value to fold over and no functional alternative that a plain DOM event
 * listener can express. `.claude/rules/functional-style.md` permits this for test instrumentation; it stays confined to
 * this file, and every reader of `stats` treats it as read-only.
 */
export const makeCountingWebSocket = (stats: WireStats): typeof WebSocket =>
  class CountingWebSocket extends WebSocket {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      super(...args);
      stats.sockets += 1;
      this.addEventListener('open', () => {
        stats.protocol = this.protocol;
      });
      this.addEventListener('message', (event: MessageEvent) => {
        const data: unknown = event.data;
        const binary = data instanceof ArrayBuffer;
        // Inflate once and derive everything from the result: this runs for every frame of every
        // replay, and inflating twice to measure and to classify was pure waste.
        const text = binary ? strFromU8(unzlibSync(new Uint8Array(data))) : String(data);
        const inflated = new TextEncoder().encode(text).byteLength;
        stats.frames.push({
          binary,
          wire: binary ? data.byteLength : inflated,
          inflated,
          type: messageType(text),
        });
      });
    }
  };

export const total = (frames: readonly Frame[], of: (f: Frame) => number): number =>
  frames.reduce((sum, f) => sum + of(f), 0);

/**
 * The fraction of bytes compression kept off the wire, as observed within a single run: total wire bytes against the
 * total the same frames occupy once inflated. This is the measure the tests assert a floor on.
 *
 * Deliberately intra-run — comparing a compressed run's totals against a separate uncompressed run's is racy, because
 * frames already in flight when a stream is torn down still reach the wire and their number varies between runs.
 *
 * @returns A ratio in `[0, 1)`; `0` for a run in which nothing was compressed.
 */
export const savingsRatio = (stats: WireStats): number => {
  const inflated = total(stats.frames, (f) => f.inflated);
  return inflated === 0 ? 0 : 1 - total(stats.frames, (f) => f.wire) / inflated;
};

/** The `annotate` function from a test's context, used to attach evidence to the test in the reporter output. */
export type Annotate = TestContext['annotate'];

/**
 * Attaches `lines` to the running test as reporter annotations, in order. Preferred over `console.log`: the notes are
 * attached to the specific test rather than emitted as loose stdout, they survive into the JUnit and HTML reports, and
 * concurrent tests cannot interleave them.
 */
export const annotateAll = (annotate: Annotate, lines: readonly string[]): Promise<unknown> =>
  lines.reduce<Promise<unknown>>((queued, line) => queued.then(() => annotate(line)), Promise.resolve());

/**
 * Records the savings a deflate-offered run actually achieved, optionally alongside a compression-off reference run
 * (omitted for fallback scenarios where only one run makes sense). Evidence only — the pass/fail decision lives in the
 * tests' own assertions; this keeps the achieved numbers visible instead of having to be re-derived by hand.
 */
export const report = (
  annotate: Annotate,
  label: string,
  events: number,
  deflate: WireStats,
  plain?: WireStats,
): Promise<unknown> => {
  const compressed = deflate.frames.filter((f) => f.binary);
  const uncompressed = deflate.frames.filter((f) => !f.binary);
  const wire = total(deflate.frames, (f) => f.wire);
  const inflated = total(deflate.frames, (f) => f.inflated);
  // e.g. "1 connection_ack, 19 complete" — the protocol chatter that stays below the server's
  // 256 B compression threshold and therefore remains plain text.
  const byType = [...new Set(uncompressed.map((f) => f.type))]
    .map((type) => `${uncompressed.filter((f) => f.type === type).length} ${type}`)
    .join(', ');
  return annotateAll(annotate, [
    `ws compression savings — ${label}`,
    `events drained: ${events}`,
    ...(plain
      ? [`plain run: ${total(plain.frames, (f) => f.wire)} B over ${plain.frames.length} frames (all text)`]
      : []),
    `deflate run (wire): ${wire} B over ${deflate.frames.length} frames (${compressed.length} compressed)`,
    `uncompressed: ${uncompressed.length} frames / ${total(uncompressed, (f) => f.wire)} B (${byType}) — ` +
      'below the server 256 B threshold or server without deflate support, sent as plain text',
    `deflate (inflated): ${inflated} B`,
    `saved: ${inflated - wire} B (${(100 * savingsRatio(deflate)).toFixed(1)}%)`,
  ]);
};
