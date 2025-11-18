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
import { NonEmptyReadonlyArray, reduce, match } from 'effect/Array';
import { dual } from 'effect/Function';

export const fold: {
  <T>(folder: (acc: T, item: T) => T): (arr: NonEmptyReadonlyArray<T>) => T;
  <T>(arr: NonEmptyReadonlyArray<T>, folder: (acc: T, item: T) => T): T;
} = dual(2, <T>(arr: NonEmptyReadonlyArray<T>, folder: (acc: T, item: T) => T): T => arr.reduce(folder));

export type Monoid<T> = {
  empty: T;
  combine: (a: T, b: T) => T;
};

export const generalSum: {
  <T>(monoid: Monoid<T>): (arr: ReadonlyArray<T>) => T;
  <T>(arr: ReadonlyArray<T>, monoid: Monoid<T>): T;
} = dual(2, <T>(arr: ReadonlyArray<T>, monoid: Monoid<T>): T => reduce(arr, monoid.empty, monoid.combine));

const numberAdditionMonoid: Monoid<number> = {
  empty: 0,
  combine: (a, b) => a + b,
};

const bigintAdditionMonoid: Monoid<bigint> = {
  empty: 0n,
  combine: (a, b) => a + b,
};

export const sumNumber: (arr: ReadonlyArray<number>) => number = generalSum(numberAdditionMonoid);

export const sumBigInt: (arr: ReadonlyArray<bigint>) => bigint = generalSum(bigintAdditionMonoid);

export const assertNonEmpty = <T>(arr: ReadonlyArray<T>): NonEmptyReadonlyArray<T> => {
  return match(arr, {
    onNonEmpty: (refined) => refined,
    onEmpty: () => {
      throw new Error('Expected non-empty array');
    },
  });
};
