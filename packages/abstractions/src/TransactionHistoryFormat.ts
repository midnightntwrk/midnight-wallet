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
import { Data } from 'effect';

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
 */
const detectVersion = (payload: unknown): string =>
  Array.isArray(payload)
    ? FIRST_FORMAT_VERSION
    : isJsonObject(payload) && typeof payload['version'] === 'string'
      ? payload['version']
      : 'unrecognised';

/**
 * Upgrade one encoded transaction-history payload from the first format to `v2`.
 *
 * Operates on the parsed JSON before any entry schema runs, so wallet packages that extend the entry shape need no
 * changes of their own. Pure: it neither reads nor writes anything outside its argument.
 *
 * The rule is fill in what is missing, never overwrite what is there — an entry that already carries a `lifecycle`
 * keeps it. That is what makes the step safe to apply to a payload it has already touched.
 *
 * @example
 *   ```ts
 *   upgradeV1ToV2([{ hash: '0xabc', status: 'SUCCESS' }]);
 *   // { version: 'v2', entries: [{ hash: '0xabc', status: 'SUCCESS', identifiers: [], lifecycle: { status: 'finalized' } }] }
 *   ```;
 *
 * @param payload - The parsed JSON of a stored history: a bare array of entries.
 * @returns The same entries wrapped in a `v2` envelope, each one carrying a `lifecycle`.
 */
export const upgradeV1ToV2 = (payload: unknown): unknown => ({
  version: CURRENT_FORMAT_VERSION,
  entries: (Array.isArray(payload) ? payload : []).map(upgradeEntryToV2),
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
 *   // { version: 'v2', entries: [...] }
 *   ```;
 *
 * @param payload - The parsed JSON of a stored history, in any format version this build knows.
 * @returns The payload in the current format.
 * @throws {TransactionHistoryRestoreError} When the payload carries a version this build does not know.
 */
export const upgradeToCurrentFormat = (payload: unknown): unknown => {
  const detectedVersion = detectVersion(payload);
  if (detectedVersion === FIRST_FORMAT_VERSION) return upgradeV1ToV2(payload);
  if (detectedVersion === CURRENT_FORMAT_VERSION) return payload;
  throw new TransactionHistoryRestoreError({
    surface: TRANSACTION_HISTORY_SURFACE,
    detectedVersion,
    cause: new Error(
      `Transaction history was written in format ${detectedVersion}, which is newer than this build's ${CURRENT_FORMAT_VERSION}.`,
    ),
  });
};
