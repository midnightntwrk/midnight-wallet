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
import { Data, Either } from 'effect';

/**
 * The format version this build writes. Every persisted surface carries one, as `{ version: 'vN', ... }`; it is the
 * version of the encoded shape and has nothing to do with `protocolVersion`, which is the chain's hard-fork number and
 * lives inside the payload.
 */
export const CURRENT_FORMAT_VERSION = 'v2';

/**
 * The first format: a bare JSON array of entries with no envelope around it. A payload with no `version` field is this
 * one — no payload has ever been written carrying the literal `'v1'`.
 */
export const FIRST_FORMAT_VERSION = 'v1';

/** The `detectedVersion` reported for a payload that matches no format this build can name. */
export const UNRECOGNISED_FORMAT_VERSION = 'unrecognised';

/** Names this persisted surface on a {@link TransactionHistoryRestoreError}, so one error type can serve all five. */
export const TRANSACTION_HISTORY_SURFACE = 'transaction-history';

/**
 * Raised when a stored transaction history cannot be brought up to {@link CURRENT_FORMAT_VERSION} — a version this build
 * does not know (written by a newer SDK), or a payload that fails to decode once upgraded.
 *
 * Never swallowed into an empty store: losing a user's history silently is worse than failing to open it.
 */
export class TransactionHistoryRestoreError extends Data.TaggedError('TransactionHistoryRestoreError')<{
  /** The persisted surface that failed, so one error type can serve all of them. */
  readonly surface: string;
  /** The version read from the payload, or {@link FIRST_FORMAT_VERSION} when it carried no envelope. */
  readonly detectedVersion: string;
  /** The underlying failure — a `ParseError` from the schema, or a thrown value from `JSON.parse`. */
  readonly cause: unknown;
}> {}

/**
 * The format a stored payload was written in, as a tagged union rather than a bare string, so every caller has to
 * account for all four cases and each case carries exactly what that case makes available.
 *
 * - `v1` — a bare array; `entries` is that array.
 * - `v2` — the current envelope; `entries` is whatever the `entries` key held, still unvalidated.
 * - `unknown` — an envelope declaring a `version` string this build does not know, i.e. written by a newer SDK.
 * - `unrecognised` — neither shape; nothing can be said about its contents.
 */
export type DetectedFormat =
  | { readonly _tag: 'v1'; readonly entries: readonly unknown[] }
  | { readonly _tag: 'v2'; readonly entries: unknown }
  | { readonly _tag: 'unknown'; readonly version: string }
  | { readonly _tag: 'unrecognised' };

/**
 * A payload brought up to {@link CURRENT_FORMAT_VERSION}, paired with the version it was actually read from.
 *
 * `version` is the _detected_ version, not the current one: it is what an error message has to name for a reader to
 * know which stored shape failed. `entries` stays `unknown` because nothing has validated it yet — the entry schema
 * runs afterwards, and it is the thing that decides whether the payload really held entries.
 */
export type UpgradedTransactionHistory = {
  /** The version the payload was read from — `'v1'` for a bare array, `'v2'` for the current envelope. */
  readonly version: string;
  /** The upgraded entries, still unvalidated. */
  readonly entries: unknown;
};

/** Narrow to a plain JSON object, so an array or `null` is not mistaken for one. */
const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Bring one encoded entry up to `v2`: give it a `lifecycle` and an `identifiers` list if it has none, and leave every
 * other field, including a `lifecycle` it already carries, exactly as it was.
 *
 * `finalized` is the only honest lifecycle for an entry written in the first format. The sole writer back then ran from
 * the sync path, after the indexer had returned the transaction inside a block; there was no pending-entry writer, so
 * no entry could have been anything else. `status` is untouched — a `FAILURE` still reached a block, it just failed
 * once it ran. No `finalizedBlock` is invented: the block is fetched from the indexer when a reader actually needs it.
 */
const upgradeEntryToV2 = (entry: unknown): unknown =>
  isJsonObject(entry) ? { identifiers: [], lifecycle: { status: 'finalized' }, ...entry } : entry;

/**
 * Read the format version a payload was written with. A bare array is the first format — the envelope did not exist
 * when it was written, so its absence is the marker.
 *
 * Exported because it is the one place that knows how a stored payload announces its shape; anything that needs to ask
 * that question should ask here rather than re-derive it.
 *
 * @param payload - The parsed JSON of a stored history.
 * @returns Which format the payload is in, and the entries that format makes available.
 */
export const detectVersion = (payload: unknown): DetectedFormat =>
  Array.isArray(payload)
    ? { _tag: 'v1', entries: payload }
    : !isJsonObject(payload) || typeof payload['version'] !== 'string'
      ? { _tag: 'unrecognised' }
      : payload['version'] === CURRENT_FORMAT_VERSION
        ? { _tag: 'v2', entries: payload['entries'] }
        : { _tag: 'unknown', version: payload['version'] };

/**
 * Upgrade one encoded transaction-history payload from the first format to `v2`.
 *
 * Operates on the parsed JSON before any entry schema runs, so wallet packages that extend the entry shape need no
 * changes of their own. Pure: it neither reads nor writes anything outside its argument.
 *
 * The rule is fill in what is missing, never overwrite what is there — an entry that already carries a `lifecycle`
 * keeps it. That is what makes the step safe to apply to a payload it has already touched.
 *
 * The parameter is an array, not `unknown`: a payload that is not a bare array is not in the first format at all, and
 * deciding that is {@link detectVersion}'s job. Accepting anything here would let a non-array turn into an empty store,
 * which is the one outcome this whole path exists to prevent.
 *
 * @example
 *   ```ts
 *   upgradeV1ToV2([{ hash: '0xabc', status: 'SUCCESS' }]);
 *   // { version: 'v2', entries: [{ hash: '0xabc', status: 'SUCCESS', identifiers: [], lifecycle: { status: 'finalized' } }] }
 *   ```;
 *
 * @param payload - The entries of a stored history written in the first format: a bare array.
 * @returns The same entries wrapped in a `v2` envelope, each one carrying a `lifecycle`.
 */
export const upgradeV1ToV2 = (
  payload: readonly unknown[],
): { readonly version: string; readonly entries: readonly unknown[] } => ({
  version: CURRENT_FORMAT_VERSION,
  entries: payload.map(upgradeEntryToV2),
});

/**
 * Run a stored transaction-history payload through every upgrade step between the version it was written with and
 * {@link CURRENT_FORMAT_VERSION}.
 *
 * Steps are chained one version at a time and never skip, so each step only ever has to know about the version
 * immediately before it and can be written once and left alone.
 *
 * @example
 *   ```ts
 *   upgradeToCurrentFormat(JSON.parse(serialized));
 *   // Either.right({ version: 'v1', entries: [...] })
 *   ```;
 *
 * @param payload - The parsed JSON of a stored history, in any format version this build knows.
 * @returns The upgraded entries and the version they were read from, or a {@link TransactionHistoryRestoreError} when
 *   the payload carries no format this build can read.
 */
export const upgradeToCurrentFormat = (
  payload: unknown,
): Either.Either<UpgradedTransactionHistory, TransactionHistoryRestoreError> => {
  const detected = detectVersion(payload);
  switch (detected._tag) {
    case 'v1':
      return Either.right({ version: FIRST_FORMAT_VERSION, entries: upgradeV1ToV2(detected.entries).entries });
    case 'v2':
      return Either.right({ version: CURRENT_FORMAT_VERSION, entries: detected.entries });
    case 'unknown':
      return Either.left(
        new TransactionHistoryRestoreError({
          surface: TRANSACTION_HISTORY_SURFACE,
          detectedVersion: detected.version,
          cause: new Error(
            `Transaction history was written in format ${detected.version}, which is newer than this build's ${CURRENT_FORMAT_VERSION}.`,
          ),
        }),
      );
    case 'unrecognised':
      return Either.left(
        new TransactionHistoryRestoreError({
          surface: TRANSACTION_HISTORY_SURFACE,
          detectedVersion: UNRECOGNISED_FORMAT_VERSION,
          cause: new Error(
            'Transaction history payload has no recognisable format: expected a bare array (v1) or an object with a string `version`.',
          ),
        }),
      );
  }
};
