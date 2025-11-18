// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { Effect, Stream, Fiber, Option, Chunk } from 'effect';
import { Observable } from 'rxjs';

/**
 * A utility that creates a Rx.js `Observable` from a given Effect `Stream`.
 *
 * @param stream The Effect `Stream` from which an `Observable` is required.
 * @returns A Rx.js `Observable` that consumes the elements from `stream`.
 */
export const fromStream = <A, E = never>(stream: Stream.Stream<A, E>): Observable<A> =>
  new Observable<A>((subscriber) => {
    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* Stream.toPull(stream);

          while (true) {
            const shouldBreak = yield* Effect.match(pull, {
              onSuccess(values) {
                Chunk.forEach(values, (element) => {
                  subscriber.next(element);
                });
                return false;
              },
              onFailure(error) {
                return Option.match(error, {
                  onNone() {
                    subscriber.complete();
                    return true; // Stream has completed, signal the break.
                  },
                  onSome: (err) => {
                    subscriber.error(err);
                    return true;
                  },
                });
              },
            });
            if (shouldBreak) break;
          }
        }),
      ),
    );

    // Ensure that if the subscription ends we also dispose of the fiber pulling from the stream.
    subscriber.add(() => Effect.runFork(Fiber.interrupt(fiber)));
  });

/**
 * A utility that creates an Effect `Stream` from a given Rx.js `Observable`.
 *
 * @param observable The Rx.js `Observable` from which a `Stream` is required.
 * @returns A `Stream` the consumes elements from `observable`.
 */
export const toStream = <A, E = never>(observable: Observable<A>): Stream.Stream<A, E> =>
  Stream.async<A, E>((emit) => {
    const subscription = observable.subscribe({
      next: (value) => void emit.single(value),
      error: (err) => void emit.fail(err as E),
      complete: () => void emit.end(),
    });

    return Effect.sync(() => subscription.unsubscribe());
  });
