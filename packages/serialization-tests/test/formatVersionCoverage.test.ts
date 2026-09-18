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
import { describe, expect, it } from 'vitest';
import {
  SURFACES,
  WRITERS,
  baseline,
  baselineFilesFor,
  currentVersionOf,
  frozenVersionsOf,
  type Surface,
  type Writer,
} from './fixtures.js';

/** `v1`, `v2`, … up to and including the version a writer says it writes for a surface. Every one must be evidenced. */
const versionsUpToCurrent = (writer: Writer, surface: Surface): readonly string[] => {
  const current = Number(currentVersionOf[writer][surface].replace('v', ''));
  return Array.from({ length: current }, (_, index) => `v${index + 1}`);
};

/** Every version any writer of a surface knows, so a frozen folder is judged against both writers rather than one. */
const versionsKnownFor = (surface: Surface): readonly string[] => [
  ...new Set(WRITERS.flatMap((writer) => versionsUpToCurrent(writer, surface))),
];

const cases = WRITERS.flatMap((writer) =>
  SURFACES.map((surface) => ({ writer, surface, name: `${writer}/${surface}` })),
);

/**
 * Is every format version this build knows backed by a payload someone can point at?
 *
 * This is the check that stops the gate eroding. The compatibility tests only prove what the fixtures they happen to
 * have still load; they say nothing about a version nobody captured. Without this, adding `v3` to a surface and
 * shipping it would pass every other test in this package, and the day a `v3` payload needed reading there would be
 * nothing to prove it ever worked.
 *
 * It fires in the pull request that introduces the version — the same change, the same author, the same branch — and
 * needs no release to have happened. That is the whole point: a fixture is owed when a format version is created, not
 * when a version number is published.
 *
 * Run per writer, because the two variants can be on different versions of one surface and each is a writer in its own
 * right: the V2 variant's current version needs its own baseline, recorded from its own output.
 */
describe('every format version this build knows is backed by a fixture', () => {
  it.each(cases)('$name', ({ writer, surface }) => {
    const required = versionsUpToCurrent(writer, surface);
    const frozen = frozenVersionsOf(surface);
    const current = currentVersionOf[writer][surface];

    // A superseded version can only ever be evidenced by a frozen payload: nothing writes it any more, so if it was
    // not captured before it was superseded, it cannot be captured now.
    const superseded = required.filter((version) => version !== current);
    expect({ writer, surface, missing: superseded.filter((version) => !frozen.includes(version)) }).toEqual({
      writer,
      surface,
      missing: [],
    });

    // The current version may instead be evidenced by the drift baseline, which is what the code writes right now.
    // A version that has shipped will also have frozen fixtures; one introduced on this branch will not yet.
    const baselineVersions = baselineFilesFor(writer, surface).map((file) => baseline(writer, file).formatVersion);
    const currentIsEvidenced = frozen.includes(current) || baselineVersions.includes(current);
    expect({ writer, surface, current, evidenced: currentIsEvidenced }).toEqual({
      writer,
      surface,
      current,
      evidenced: true,
    });
  });

  it('should have a baseline for every writer and surface', () => {
    expect(cases.filter(({ writer, surface }) => baselineFilesFor(writer, surface).length === 0)).toEqual([]);
  });

  // A frozen folder for a version the code has never heard of means either a fixture filed under the wrong name or a
  // version that was removed without its upgrade step — both worth stopping.
  it('should have no frozen fixtures for a version this build does not know', () => {
    const unknown = SURFACES.flatMap((surface) =>
      frozenVersionsOf(surface)
        .filter((version) => !versionsKnownFor(surface).includes(version))
        .map((version) => `${surface}/${version}`),
    );

    expect(unknown).toEqual([]);
  });
});
