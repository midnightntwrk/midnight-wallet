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
/**
 * A utility type that checks whether type A can be assigned to type To
 * It appears to be useful when exact inferred type are slightly too complex to express and we want the express
 * a slightly simplified type rule like Expect<CanAssign<{foo: number}, object & {foo: number}>>
 */
export type CanAssign<A, To> = A extends To ? true : false;

/**
 * A utility type that ensures that a given type is `true` or otherwise forces a compile time error.
 */
export type Expect<T extends true> = T;

export type ItemType<T> = T extends ReadonlyArray<infer R> ? R : never;

/**
 * A utility type that exactly compares two types for equality.
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
