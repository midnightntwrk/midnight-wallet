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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { dispatch, type PolyFunction, type WithTag } from './polyFunction.js';

/**
 * Heterogeneous list - as in - list, where elements have different types
 * Here - more as an additional API over TS's tuple type
 */
export type Empty = [];
export type NonEmpty<T> = T extends Array<infer E> ? [E, ...T] : never;
export type Prepend<List extends unknown[], Element> = [Element, ...List];
export type Append<List extends unknown[], Element> = [...List, Element];
export type Reverse<List extends unknown[]> = List extends [...infer Init, infer Last]
  ? [Last, ...Reverse<Init>]
  : List extends []
    ? []
    : never;

export type HeadOr<List, Default> = List extends [infer TheHead, ...any[]]
  ? TheHead
  : List extends []
    ? Default
    : never;
export type Head<List extends any[]> = HeadOr<List, never>;

export type Tail<List extends unknown[]> = List extends [unknown, ...infer Tail] ? Tail : [];

export type Tails<List extends unknown[]> = List extends [unknown, ...infer Tail] ? Tails<Tail> | Tail : [];

export type Each<List extends unknown[]> = List[number];

export type Find<List extends any[], Predicate> = List extends [infer TheHead, ...infer Rest]
  ? TheHead extends Predicate
    ? TheHead
    : Find<Rest, Predicate>
  : never;

export const empty: Empty = [];

export const prepend = <List extends unknown[], Element>(list: List, element: Element): Prepend<List, Element> => {
  return [element, ...list];
};

export const append = <List extends unknown[], Element>(list: List, element: Element): Append<List, Element> => {
  return [...list, element];
};

export function headOr<List extends unknown[], Default>(list: List, def: () => Default): HeadOr<List, Default> {
  if (list.length == 0) {
    return def() as HeadOr<List, Default>;
  } else {
    return list.at(0) as Head<List>;
  }
}

export const head = <List extends unknown[]>(list: List): Head<List> => {
  return headOr(list, () => {
    throw new Error('Cannot get head from empty hlist');
  });
};

export const tail = <List extends unknown[]>(list: List): Tail<List> => {
  return list.toSpliced(0, 1) as Tail<List>;
};

export const reverse = <List extends unknown[]>(list: List): Reverse<List> => {
  return list.toReversed() as Reverse<List>;
};

export const find = <List extends unknown[], Predicate>(
  list: List,
  predicate: (value: Each<List>) => value is Predicate,
): Find<List, Predicate> => {
  return list.find(predicate) as Find<List, Predicate>;
};

export const foldLeft = <List extends WithTag<string | symbol>[], Acc>(
  list: List,
  acc: Acc,
  folder: (acc: Acc) => PolyFunction<Each<List>, Acc>,
): Acc => {
  return list.reduce((acc, item) => dispatch(item, folder(acc)), acc);
};
export const foldRight = <List extends WithTag<string | symbol>[], Acc>(
  list: List,
  acc: Acc,
  folder: (acc: Acc) => PolyFunction<Each<List>, Acc>,
): Acc => {
  return list.reduceRight((acc, item) => dispatch(item, folder(acc)), acc);
};
