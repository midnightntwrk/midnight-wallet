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
