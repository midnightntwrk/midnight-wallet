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
import { Cause, Effect, Exit, Option } from 'effect';

/**
 * Rejects a promise with the typed failure itself rather than the fiber wrapper around it, so a caller can read the
 * error's tag and fields.
 *
 * @remarks
 *   `E extends Error` is what makes that rejection legitimate rather than a thrown bare value, and every failure on this
 *   surface is a `Data.TaggedError`, which is one. A defect or interruption has no typed failure to hand over, so it is
 *   rejected with its pretty-printed cause, keeping what was thrown as the `cause`.
 */
export const runPromiseThrowingFailure = async <A, E extends Error>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw new Error(Cause.pretty(exit.cause), { cause: Cause.squash(exit.cause) });
};
