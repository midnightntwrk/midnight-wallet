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
import { ProtocolState } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Chunk, Equivalence } from 'effect';
import { type Observable, type OperatorFunction, reduce } from 'rxjs';

/**
 * Utility function that takes state values from an RxJS observable until it completes or errors.
 *
 * @param observable The RxJS observable from which state values should be read.
 * @param onErrCallback An optional callback to invoke if an error is encountered reading a state value.
 * @returns A `Promise` that resolves with an array of state values that were received before encountering any error.
 * @internal
 */
export const toProtocolStateArray = <T>(
  observable: Observable<ProtocolState.ProtocolState<T>>,
  onErrCallback?: (err: unknown) => void,
): Promise<ProtocolState.ProtocolState<T>[]> =>
  new Promise<ProtocolState.ProtocolState<T>[]>((resolve) => {
    const receivedStates: ProtocolState.ProtocolState<T>[] = [];

    observable.subscribe({
      next(value) {
        receivedStates.push(value);
      },
      complete() {
        resolve(receivedStates);
      },
      error(err) {
        onErrCallback?.call(undefined, err);
        resolve(receivedStates);
      },
    });
  });

export const reduceToChunk = <T>(): OperatorFunction<T, Chunk.Chunk<T>> =>
  reduce((chunk, value) => Chunk.append(chunk, value), Chunk.empty<T>());

/**
 * Checks whether `received` is an ordered subsequence of `expected` — every received element appears in `expected` in
 * the same relative order, though elements of `expected` may be skipped.
 *
 * This matches the runtime's latest-value state stream contract: a subscriber always converges on the latest state, but
 * may skip intermediate states when it lags behind the producer. Received states must therefore never be reordered,
 * fabricated, or repeated out of order — but any prefix of intermediate states may be missing.
 *
 * @internal
 */
export const isOrderedSubsequenceOf = <T>(
  received: readonly T[],
  expected: readonly T[],
  equals: Equivalence.Equivalence<T>,
): boolean => {
  const searchEnd = received.reduce((searchFrom: number, value) => {
    if (searchFrom < 0) {
      return searchFrom;
    }
    const index = expected.findIndex((candidate, i) => i >= searchFrom && equals(candidate, value));
    return index < 0 ? -1 : index + 1;
  }, 0);
  return searchEnd >= 0;
};

/**
 * Equality of {@link ProtocolState.ProtocolState} values over primitive states, for use with
 * {@link isOrderedSubsequenceOf}.
 *
 * @internal
 */
export const protocolStateEquals: Equivalence.Equivalence<ProtocolState.ProtocolState<unknown>> =
  ProtocolState.getEquivalence(Equivalence.strict());

export const isRange = (values: Chunk.Chunk<number>): boolean => {
  const firstDropped = Chunk.drop(values, 1);
  const lastDropped = Chunk.dropRight(values, 1);
  return Chunk.zip(lastDropped, firstDropped).pipe(Chunk.every(([l, r]) => r == l + 1));
};
