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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransactionHistoryFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { Serialization as DustV1Serialization } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { Serialization as DustV2Serialization } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import { Serialization as ShieldedV1Serialization } from '@midnightntwrk/wallet-sdk-shielded/v1';
import { Serialization as ShieldedV2Serialization } from '@midnightntwrk/wallet-sdk-shielded/v2';
import { Serialization as UnshieldedV1Serialization } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Serialization as UnshieldedV2Serialization } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

/**
 * Where the drift baselines live: what the current code writes, for every surface, one folder per writer.
 *
 * They are rewritten whenever the current output changes, so they carry no compatibility promise and are never frozen
 * fixtures. The leading underscore keeps the folder out of the surface listing.
 */
export const BASELINE_DIR = '_baseline';

/**
 * The two wallet variants that write snapshots: V1 on ledger-v8 below `forks.v9`, V2 on ledger-v9 from it.
 *
 * Both are real writers of the same surfaces, and a change to either is a change to a persisted format, so the gate
 * runs every check against each. The transaction-history and pending-transaction surfaces have one writer apiece,
 * outside the twins; they are listed under both so that every check has one shape of case to iterate.
 */
export const WRITERS = ['v1', 'v2'] as const;

export type Writer = (typeof WRITERS)[number];

/**
 * The five persisted surfaces — the strings the SDK hands an application to store and hand back later.
 *
 * Each has its own format-version line: the transaction history is on `v2` while the four others are still on `v1`,
 * because a format version belongs to a surface, not to a release.
 */
export const SURFACES = ['shielded', 'unshielded', 'dust', 'tx-history', 'pending-transactions'] as const;

export type Surface = (typeof SURFACES)[number];

/**
 * The format version each writer's code says it writes today, per surface, read from the code rather than restated here
 * — so this cannot drift from the source it is checking.
 *
 * The two variants may write different versions of one surface: the V2 unshielded writer is on `v2`, because its
 * verifying key carries a tag the V1 writer's bare string does not. Pending transactions is the one exception to
 * reading from code: its `'v1'` lives inline in a `Schema.Literal` and the surface is deliberately left alone, so the
 * version is named here instead of exporting a constant from it.
 */
export const currentVersionOf: Record<Writer, Record<Surface, string>> = {
  v1: {
    shielded: ShieldedV1Serialization.SNAPSHOT_FORMAT_VERSION,
    unshielded: UnshieldedV1Serialization.SNAPSHOT_FORMAT_VERSION,
    dust: DustV1Serialization.SNAPSHOT_FORMAT_VERSION,
    'tx-history': TransactionHistoryFormat.CURRENT_FORMAT_VERSION,
    'pending-transactions': 'v1',
  },
  v2: {
    shielded: ShieldedV2Serialization.SNAPSHOT_FORMAT_VERSION,
    unshielded: UnshieldedV2Serialization.SNAPSHOT_FORMAT_VERSION,
    dust: DustV2Serialization.SNAPSHOT_FORMAT_VERSION,
    'tx-history': TransactionHistoryFormat.CURRENT_FORMAT_VERSION,
    'pending-transactions': 'v1',
  },
};

/**
 * One captured payload.
 *
 * `serialized` is verbatim — the exact string a published SDK handed an application to store. Nothing in this package
 * may edit it; that is what the frozen-file check in CI enforces. Everything else describes where it came from and what
 * it should contain once restored, so a test can assert on content rather than settling for "it did not throw".
 */
export type Fixture = {
  /** The surface this payload belongs to. */
  readonly surface: Surface;
  /** The format version of the payload's shape, e.g. `v1`. */
  readonly formatVersion: string;
  /** Where it came from: the release that wrote it, plus a variant suffix when a release has several. */
  readonly origin: string;
  /** `<surface>/<formatVersion>/<origin>`, for test names. */
  readonly id: string;
  /** The stored payload, exactly as it was written. */
  readonly serialized: string;
  /** What the payload should contain once restored. Which keys are present varies by fixture. */
  readonly expected: Record<string, unknown>;
  /** The package that wrote it, and its version, as recorded at capture time. */
  readonly writtenBy: { readonly name: string; readonly version: string };
};

const read = (surface: Surface, formatVersion: string, file: string): Fixture => {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, surface, formatVersion, file), 'utf8')) as Record<
    string,
    unknown
  >;
  const origin = file.replace(/\.json$/, '');
  return {
    surface,
    formatVersion,
    origin,
    id: `${surface}/${formatVersion}/${origin}`,
    serialized: raw['serialized'] as string,
    expected: (raw['expected'] ?? {}) as Record<string, unknown>,
    writtenBy: { name: raw['name'] as string, version: raw['version'] as string },
  };
};

const dirsIn = (path: string): readonly string[] =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

/**
 * Every format version that has frozen fixtures for a surface, oldest first.
 *
 * @param surface - The persisted surface.
 * @returns The version folder names, e.g. `['v1', 'v2']`.
 */
export const frozenVersionsOf = (surface: Surface): readonly string[] => dirsIn(join(FIXTURES_DIR, surface));

/**
 * Every frozen payload for a surface, across every format version it has fixtures for.
 *
 * @param surface - The persisted surface.
 * @returns Every fixture, ordered by format version then origin.
 */
export const fixturesFor = (surface: Surface): readonly Fixture[] =>
  frozenVersionsOf(surface).flatMap((formatVersion) =>
    readdirSync(join(FIXTURES_DIR, surface, formatVersion))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => read(surface, formatVersion, file)),
  );

/**
 * The drift baseline file names for a writer and surface — one per fixture variant, so a surface with several shapes
 * keeps them all.
 *
 * @param writer - The variant whose output the baseline records.
 * @param surface - The persisted surface.
 * @returns The baseline filenames, e.g. `['shielded-deep.json', 'shielded.json']`; empty when none was captured.
 */
export const baselineFilesFor = (writer: Writer, surface: Surface): readonly string[] => {
  const dir = join(FIXTURES_DIR, BASELINE_DIR, writer);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file === `${surface}.json` || file.startsWith(`${surface}-`))
        .sort()
    : [];
};

/**
 * The format version a payload is in, read from the payload itself.
 *
 * A payload with no envelope is the first version of its surface — the envelope did not exist when it was written, so
 * its absence is the marker. No payload has ever been written carrying the literal `v1`.
 *
 * Deliberately not `TransactionHistoryFormat.detectVersion`, whose fallback is `unrecognised`. This one answers a
 * different question: it reads the declared version of any persisted surface, in a corpus where every payload is known
 * to be one this repo wrote, so a payload with no envelope is the first format by definition rather than one that
 * failed to parse. Refusing an unrecognised shape is the SDK's job; here it would only hide which fixture is wrong
 * behind a fixture-loading error.
 *
 * @param serialized - The stored payload.
 * @returns The format version, e.g. `v1`.
 */
export const declaredVersionOf = (serialized: string): string => {
  const payload: unknown = JSON.parse(serialized);
  if (Array.isArray(payload)) return 'v1';
  if (typeof payload === 'object' && payload !== null) {
    const version = (payload as Record<string, unknown>)['version'];
    if (typeof version === 'string') return version;
  }
  return 'v1';
};

/**
 * One recorded baseline: what the current code wrote the last time the baseline was captured.
 *
 * It is not a compatibility fixture and carries no promise — it exists so that a change to what this build _writes_
 * cannot pass unnoticed.
 *
 * @param writer - The variant whose output the baseline records.
 * @param file - The baseline filename, from {@link baselineFilesFor}.
 * @returns The baseline payload and the format version it declares.
 * @throws When the baseline is missing, which means it was never captured.
 */
export const baseline = (
  writer: Writer,
  file: string,
): { readonly serialized: string; readonly formatVersion: string } => {
  const path = join(FIXTURES_DIR, BASELINE_DIR, writer, file);
  if (!existsSync(path)) {
    throw new Error(`no drift baseline '${writer}/${file}'. Capture one with: yarn capture`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const serialized = raw['serialized'] as string;
  return { serialized, formatVersion: declaredVersionOf(serialized) };
};
