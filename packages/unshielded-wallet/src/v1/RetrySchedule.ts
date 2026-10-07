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
import { Duration, Schedule } from 'effect';

/** The longest the sync streams wait between two retries. */
const MAX_RETRY_DELAY = Duration.minutes(2);

/**
 * Exponential backoff with jitter, capped at two minutes — shared by both sync streams.
 *
 * @remarks
 *   The cap is a real bound on the recurrence interval, not on the schedule's output. `Schedule.map` over an exponential
 *   schedule transforms only the value it emits; the interval the runtime waits keeps doubling, reaches half an hour by
 *   the twelfth retry and overflows the timer within a day, after which the stream never retries again.
 *   `Schedule.union` recurs whenever either schedule would, so the interval is the smaller of the two — the exponential
 *   until it passes the cap, the cap from then on. Jitter is applied before the union so the cap is hard: applied
 *   after, its upper band could stretch a capped wait past two minutes.
 * @returns A schedule whose output — the pair of both schedules' outputs — carries nothing a retry loop reads.
 */
export const retrySchedule = (): Schedule.Schedule<readonly [Duration.Duration, number], unknown> =>
  Schedule.exponential(Duration.seconds(1), 2).pipe(
    Schedule.jittered,
    Schedule.union(Schedule.spaced(MAX_RETRY_DELAY)),
  );
