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
import { Chunk, Duration, Effect, Schedule } from 'effect';
import { describe, expect, it } from 'vitest';
import { retrySchedule } from '../RetrySchedule.js';

const TWO_MINUTES_MS = Duration.toMillis(Duration.minutes(2));

/**
 * The real interval between recurrences, for each of `count` consecutive retries.
 *
 * @remarks
 *   A schedule's output value and its recurrence interval are different things: `Schedule.delays` reports the interval
 *   the runtime actually waits, which is what a retry loop experiences. Asserting on the output alone would pass a
 *   schedule whose interval is unbounded.
 */
const realDelaysMs = (count: number): readonly number[] =>
  Effect.runSync(
    Schedule.run(
      Schedule.delays(retrySchedule()),
      0,
      Array.from({ length: count }, (_, i) => i),
    ),
  ).pipe(Chunk.map(Duration.toMillis), Chunk.toReadonlyArray);

describe('retrySchedule', () => {
  it('should never wait longer than two minutes between retries, so an outage is retried at a steady cadence', () => {
    // An uncapped doubling reaches half an hour by the twelfth retry and overflows the runtime's timer within a day,
    // at which point the stream stops retrying altogether — a wallet that never reconnects after a long outage.
    const delays = realDelaysMs(30);

    delays.forEach((delay) => expect(delay).toBeLessThanOrEqual(TWO_MINUTES_MS));
  });

  it('should settle at exactly the cap once the exponential has passed it', () => {
    // From the ninth retry the un-jittered delay is 256 s and cannot dip below the cap even at minimum jitter, so
    // every later interval is the cap itself — the steady cadence a long outage should be polled at.
    const delays = realDelaysMs(30);

    expect(delays.slice(8)).toStrictEqual(Array.from({ length: 22 }, () => TWO_MINUTES_MS));
  });

  it('should start at about one second and double, with jitter, before the cap', () => {
    // Jitter keeps a fleet of wallets from reconnecting in lock-step after a shared outage. Effect's default band is
    // 0.8–1.2 of the nominal delay, so the bounds below are those of the first two retries.
    const [first, second] = realDelaysMs(2);

    expect(first).toBeGreaterThanOrEqual(800);
    expect(first).toBeLessThanOrEqual(1_200);
    expect(second).toBeGreaterThanOrEqual(1_600);
    expect(second).toBeLessThanOrEqual(2_400);
  });
});
