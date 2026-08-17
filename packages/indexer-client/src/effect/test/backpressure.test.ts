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
import { describe, it, expect } from 'vitest';
import {
  initialBPState,
  decideItem,
  decideTerminate,
  decideComplete,
  decideResume,
  type BPState,
} from '../Backpressure.js';

const state = (overrides: Partial<BPState> = {}): BPState => ({
  ...initialBPState(0n),
  ...overrides,
});

describe('Backpressure state machine', () => {
  describe('decideItem', () => {
    it('emits and advances watermark when key is strictly greater than lastKey', () => {
      const [decision, next] = decideItem(state({ lastKey: 5n }), 6n, 0, 1000);
      expect(decision).toEqual({ emit: true, pause: false });
      expect(next.lastKey).toBe(6n);
      expect(next.inFlight).toBe(1);
    });

    it('drops the item at `from` on the initial session (exclusive watermark)', () => {
      // The watermark seeds from `from`, so the item whose key equals `from` is treated as
      // already-seen. A caller that wants the item at its logical cursor emitted seeds `from` one
      // below it (e.g. a wallet passes `appliedIndex - 1` to still receive the boundary event).
      const before = initialBPState(5n);
      const [decision, next] = decideItem(before, 5n, 0, 1000);
      expect(decision.emit).toBe(false);
      expect(next).toBe(before);
    });

    it('drops a re-delivered boundary equal to lastKey (inclusive-cursor dedup)', () => {
      // An inclusive resume cursor re-delivers the last-emitted key; the exclusive watermark drops
      // it so it is not emitted twice.
      const before = state({ lastKey: 5n, inFlight: 0 });
      const [decision, next] = decideItem(before, 5n, 0, 1000);
      expect(decision.emit).toBe(false);
      expect(next).toBe(before);
    });

    it('drops items below lastKey', () => {
      const before = state({ lastKey: 5n });
      const [decision, next] = decideItem(before, 3n, 0, 1000);
      expect(decision.emit).toBe(false);
      expect(next).toBe(before);
    });

    it('drops items from a stale generation', () => {
      const before = state({ generation: 2 });
      const [decision, next] = decideItem(before, 1n, 1, 1000);
      expect(decision.emit).toBe(false);
      expect(next).toBe(before);
    });

    it('drops items when terminal', () => {
      const before = state({ terminal: true });
      const [decision, next] = decideItem(before, 1n, 0, 1000);
      expect(decision.emit).toBe(false);
      expect(next).toBe(before);
    });

    it('sets pause when inFlight reaches bufferSize', () => {
      const [decision, next] = decideItem(state({ lastKey: 5n, inFlight: 2 }), 6n, 0, 3);
      expect(decision).toEqual({ emit: true, pause: true });
      expect(next.paused).toBe(true);
      expect(next.inFlight).toBe(3);
    });

    it('does not re-pause when already paused', () => {
      const [decision, next] = decideItem(state({ lastKey: 5n, inFlight: 3, paused: true }), 6n, 0, 3);
      expect(decision).toEqual({ emit: true, pause: false });
      expect(next.paused).toBe(true);
    });
  });

  describe('decideTerminate', () => {
    it('surfaces a terminal event and marks state terminal', () => {
      const [shouldSurface, next] = decideTerminate(state(), 0);
      expect(shouldSurface).toBe(true);
      expect(next.terminal).toBe(true);
    });

    it('swallows terminal events from a stale generation', () => {
      const before = state({ generation: 2 });
      const [shouldSurface, next] = decideTerminate(before, 1);
      expect(shouldSurface).toBe(false);
      expect(next).toBe(before);
    });

    it('is idempotent — already-terminal state returns false', () => {
      const before = state({ terminal: true });
      const [shouldSurface, next] = decideTerminate(before, 0);
      expect(shouldSurface).toBe(false);
      expect(next).toBe(before);
    });
  });

  describe('decideComplete', () => {
    it('signals end-of-stream when not paused, stale, or terminal', () => {
      const [shouldEnd, next] = decideComplete(state(), 0);
      expect(shouldEnd).toBe(true);
      expect(next.terminal).toBe(true);
    });

    it('treats paused completion as dispose-induced (no end)', () => {
      // This is the regression case: without the paused check, a dispose-on-pause
      // would deliver a `complete:` from the old session and terminate the
      // consumer-visible stream mid-resume.
      const before = state({ paused: true });
      const [shouldEnd, next] = decideComplete(before, 0);
      expect(shouldEnd).toBe(false);
      expect(next).toBe(before);
    });

    it('swallows completions from a stale generation', () => {
      const before = state({ generation: 2 });
      const [shouldEnd, next] = decideComplete(before, 1);
      expect(shouldEnd).toBe(false);
      expect(next).toBe(before);
    });
  });

  describe('decideResume', () => {
    it('resumes and bumps generation when paused and drained to threshold', () => {
      const [shouldResume, next] = decideResume(state({ paused: true, inFlight: 3, generation: 4 }), 2);
      expect(shouldResume).toBe(true);
      expect(next).toMatchObject({ paused: false, inFlight: 2, generation: 5 });
    });

    it('decrements inFlight even when not resuming (drain accounting)', () => {
      const [shouldResume, next] = decideResume(state({ paused: false, inFlight: 7 }), 2);
      expect(shouldResume).toBe(false);
      expect(next.inFlight).toBe(6);
    });

    it('does not resume when above threshold', () => {
      const [shouldResume, next] = decideResume(state({ paused: true, inFlight: 5 }), 2);
      expect(shouldResume).toBe(false);
      expect(next).toMatchObject({ paused: true, inFlight: 4 });
    });

    it('does not resume when terminal', () => {
      const before = state({ paused: true, inFlight: 3, terminal: true });
      const [shouldResume, next] = decideResume(before, 2);
      expect(shouldResume).toBe(false);
      expect(next).toBe(before);
    });

    it('clamps inFlight at zero (defensive against drain underflow)', () => {
      const [, next] = decideResume(state({ inFlight: 0 }), 2);
      expect(next.inFlight).toBe(0);
    });

    it('does not resume when not paused, even if drained', () => {
      const [shouldResume] = decideResume(state({ paused: false, inFlight: 0 }), 2);
      expect(shouldResume).toBe(false);
    });
  });
});
