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
 * Tiny typed wrappers around vitest's asymmetric matchers.
 *
 * Vitest types `expect.stringContaining` / `expect.stringMatching` as returning `any`. Centralising the cast in one
 * place — the callsites use these helpers — lets every callsite that passes the matcher into a strictly-typed object
 * literal (e.g. `{ reason: string }` from `toMatchObject`) stay typed instead of repeating `as unknown as string`.
 *
 * This is a typing convenience, not a runtime change — the returned value is still vitest's `StringContaining` /
 * `StringMatching` instance, which `toMatchObject` recognises by its `asymmetricMatch` method, not by its declared
 * type. The `string` return type is a narrow lie at the type level; vitest does the right thing at runtime.
 */

import { expect } from 'vitest';

/** Like `expect.stringContaining`, but typed as `string` so it can sit in strictly-typed `toMatchObject` shapes. */
export const containsString = (substring: string): string => {
  const matcher: unknown = expect.stringContaining(substring);
  return matcher as string;
};

/** Like `expect.stringMatching`, but typed as `string` for use in strictly-typed `toMatchObject` shapes. */
export const matchesString = (pattern: RegExp | string): string => {
  const matcher: unknown = expect.stringMatching(pattern);
  return matcher as string;
};
