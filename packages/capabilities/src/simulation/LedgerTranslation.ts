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
 * Translating a ledger-v8 state into a ledger-v9 one.
 *
 * The translation itself is a ledger-side tool reached across a WASM boundary, so this module only describes the seam,
 * never the mechanism: serialized bytes in, serialized bytes out, as an `Effect`. Bytes because that is the only thing
 * that crosses the boundary — neither ledger's state objects exist in the other's WASM module. An `Effect` because the
 * tool has to be loaded and then run to completion (it translates incrementally, under a cost budget per step), and
 * both are the translator's business rather than the caller's.
 */

import { Data, Effect } from 'effect';

/** Thrown when a ledger-v8 state cannot be translated into a ledger-v9 one. */
export class LedgerTranslationError extends Data.TaggedError('LedgerTranslationError')<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Translates a serialized ledger-v8 state into a serialized ledger-v9 one.
 *
 * Implementations own loading whatever performs the translation and running it to completion. Deserializing the result
 * is the caller's, so bytes that are not valid ledger-v9 state are reported as a translation failure.
 */
export type LedgerStateTranslator = (v8State: Uint8Array) => Effect.Effect<Uint8Array, LedgerTranslationError>;

/**
 * Build a translator from an async function, turning anything it throws or rejects with into a
 * {@link LedgerTranslationError}.
 *
 * This is how the WASM tool is meant to be plugged in: its call is asynchronous and it signals failure by throwing, so
 * this is the whole adapter.
 *
 * @example
 *   ```typescript
 *   const translator = translatorFromAsync(async (bytes) => {
 *     const tool = await loadStateTranslation();
 *     return tool.translate(bytes);
 *   });
 *   ```;
 *
 * @param translate - Async translation of serialized ledger-v8 state into serialized ledger-v9 state
 * @returns A translator over that function
 */
export const translatorFromAsync =
  (translate: (v8State: Uint8Array) => Promise<Uint8Array>): LedgerStateTranslator =>
  (v8State) =>
    Effect.tryPromise({
      try: () => translate(v8State),
      catch: (cause) => new LedgerTranslationError({ message: 'Ledger state translation failed', cause }),
    });

/**
 * A translator that always fails, standing in for the real tool until it exists.
 *
 * Useful as an explicit default: a fork configured with it fails loudly at the boundary, rather than silently crossing
 * it with state that was never translated.
 */
export const unavailableTranslator: LedgerStateTranslator = () =>
  Effect.fail(
    new LedgerTranslationError({
      message: 'A v8-to-v9 ledger state translation is not yet available; supply a translator explicitly',
    }),
  );
