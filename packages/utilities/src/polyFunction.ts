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
export type WithTag<T extends string | symbol> = {
  __polyTag__: T;
};
export type TagOf<T> = T extends WithTag<infer Tag> ? Tag : never;

export type WithTagFrom<T> = WithTag<TagOf<T>>;
/**
 * Polymorphic function - function defined for multiple types at once
 * Leveraging tagging mechanics it can predictably work at runtime and be quite intuitively defined by hand
 */
export type PolyFunction<Variants extends WithTag<string | symbol>, T> = {
  [V in Variants as TagOf<V>]: (variant: V) => T;
};

export const getTag = <TTag extends string | symbol>(t: WithTag<TTag>): TTag => t.__polyTag__;

export const dispatch = <TVariant extends WithTag<string | symbol>, TResult>(
  subject: TVariant,
  impl: PolyFunction<TVariant, TResult>,
): TResult => {
  if (subject.__polyTag__ in impl) {
    //Sadly, the type casts below are needed because eslint or TS limitations
    const subjectTag = subject.__polyTag__ as TagOf<TVariant>;
    const chosen = impl[subjectTag] as (v: TVariant) => TResult;
    return chosen(subject);
  } else {
    throw new Error(`Not found implementation for ${String(subject.__polyTag__)}`);
  }
};
