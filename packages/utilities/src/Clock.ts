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
 * A clock abstraction for obtaining the current time. By default the system clock is used; inject a custom clock (e.g.
 * one backed by a simulator's time) for testing time-dependent behaviour.
 */
export type Clock = {
  readonly now: () => Date;
};

/** Default {@link Clock} backed by real system time. */
export const systemClock: Clock = { now: () => new Date() };
