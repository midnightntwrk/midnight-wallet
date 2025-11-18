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
import { ProtocolState } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Chunk } from 'effect';
import { Observable, OperatorFunction, reduce } from 'rxjs';

/**
 * Utility function that takes state values from an RxJS observable until it completes or errors.
 *
 * @param observable The RxJS observable from which state values should be read.
 * @param onErrCallback An optional callback to invoke if an error is encountered reading a state value.
 * @returns A `Promise` that resolves with an array of state values that were received before encountering
 * any error.
 *
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

export const isRange = (values: Chunk.Chunk<number>): boolean => {
  const firstDropped = Chunk.drop(values, 1);
  const lastDropped = Chunk.dropRight(values, 1);
  return Chunk.zip(lastDropped, firstDropped).pipe(Chunk.every(([l, r]) => r == l + 1));
};
