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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASELINE_DIR, SURFACES, WRITERS, baseline, baselineFilesFor, type Writer } from './fixtures.js';
import { rewriteWithCurrentCode, sourceForBaseline } from './rewrite.js';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

/** Capture mode rewrites the baselines instead of asserting against them. See the package README. */
const CAPTURING = process.env['CAPTURE_BASELINE'] === '1';

/**
 * One case per writer and baseline file. A writer with no baselines yet is given the other writer's file names, so the
 * first capture for it has something to record; after that its own folder is the list.
 */
const baselineNamesFor = (writer: Writer, surface: (typeof SURFACES)[number]): readonly string[] => {
  const own = baselineFilesFor(writer, surface);
  return own.length > 0 ? own : WRITERS.flatMap((other) => baselineFilesFor(other, surface));
};

const cases = WRITERS.flatMap((writer) =>
  SURFACES.flatMap((surface) =>
    baselineNamesFor(writer, surface).map((file) => ({
      writer,
      surface,
      file,
      name: `${writer}/${file.replace(/\.json$/, '')}`,
    })),
  ),
);

/**
 * Does the current code still write the shape the last capture recorded?
 *
 * Nothing here is about reading old data — that is the compatibility tests' job. This asks the other question: has the
 * **writer** changed? A persisted format can only be governed if a change to it is impossible to make by accident, and
 * comparing against a recorded payload is the only check that cannot be satisfied by a plausible near-miss.
 *
 * When this goes red, the diff says which it is:
 *
 * - An optional field added → intended. Re-record with `yarn capture` and commit the diff.
 * - A field removed, renamed or retyped → a new format version, which needs an upgrade step and a new frozen folder.
 *   Re-recording instead would erase the evidence that anything changed, and `formatVersionCoverage` would then fail
 *   for the fixture the new version is missing.
 *
 * Capture runs through this same file rather than a script of its own, so what gets recorded and what gets checked are
 * produced by one code path and cannot drift apart.
 */
describe('what the current code writes, against the recorded baseline', () => {
  it.each(cases)('should still write $name exactly as the baseline records it', async ({ writer, surface, file }) => {
    const source = sourceForBaseline(surface, file);

    const rewritten = await rewriteWithCurrentCode(writer, surface, source.serialized);

    if (CAPTURING) {
      const dir = join(FIXTURES_DIR, BASELINE_DIR, writer);
      const path = join(dir, file);
      // A baseline never captured before starts from the source fixture's own record of what it holds, so the file
      // says where its payload came from the same way an older one does.
      const existing = existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
        : { name: source.writtenBy.name, version: source.writtenBy.version, expected: source.expected };
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path,
        `${JSON.stringify({ ...existing, writer, capturedFrom: source.id, serialized: rewritten }, null, 2)}\n`,
      );
      return;
    }

    expect(JSON.parse(rewritten)).toEqual(JSON.parse(baseline(writer, file).serialized));
  });
});
