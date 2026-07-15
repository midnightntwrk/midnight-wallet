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
import { readdirSync, existsSync, readFileSync } from 'node:fs';

/**
 * A committed fixture produced by `fixture-generator/generate.mjs` with a real published SDK version. `serialized` is
 * byte-for-byte what that version's serialization capability wrote (wallet states produced by event replay through that
 * version's own sync path); `expected` records the content it contains, emitted from the same objects that were
 * serialized.
 */
export type Fixture = {
  train: string;
  name: string;
  version: string;
  ledgerDep?: string;
  serialized: string;
  expected: Record<string, unknown>;
};

const FIXTURES_DIR = new URL('../fixtures/', import.meta.url);

/**
 * The provisional train captured from the CURRENT workspace by `capture-unreleased.mjs`. It is the drift baseline but
 * NOT a compatibility train — compat only tests bytes a real published version wrote. At release, the
 * `reconcile-train.mjs` hook (run from `changeset:version`) renames it to `facade-<the actual bump>`, at which point it
 * automatically joins {@link TRAINS} because it is no longer named `facade-unreleased`.
 */
export const UNRELEASED_TRAIN = 'facade-unreleased';

const versionParts = (train: string): readonly number[] => train.replace('facade-', '').split('.').map(Number);

const bySemver = (a: string, b: string): number => {
  const [pa, pb] = [versionParts(a), versionParts(b)];
  const len = Math.max(pa.length, pb.length);
  return Array.from({ length: len }, (_, i) => (pa[i] ?? 0) - (pb[i] ?? 0)).find((diff) => diff !== 0) ?? 0;
};

const allTrainDirs = (): readonly string[] =>
  readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('facade-'))
    .map((entry) => entry.name);

/** Published trains (semver-ascending); excludes the {@link UNRELEASED_TRAIN} capture. */
export const TRAINS = allTrainDirs()
  .filter((train) => train !== UNRELEASED_TRAIN)
  .sort(bySemver);

/** The train the format-drift gate compares current output against: the unreleased capture if present, else newest. */
export const DRIFT_BASELINE = allTrainDirs().includes(UNRELEASED_TRAIN) ? UNRELEASED_TRAIN : TRAINS[TRAINS.length - 1];

const trainHasFixture = (train: string, name: FixtureName): boolean =>
  existsSync(new URL(`../fixtures/${train}/${name}.json`, import.meta.url));

/** Published trains that carry a tx-history payload (the storage layer only exists from facade-4.0.0 on). */
export const TX_HISTORY_TRAINS = TRAINS.filter((train) => trainHasFixture(train, 'tx-history'));

/** Published trains that carry a pending-transactions payload (the capabilities layer exists from facade-2.0.0 on). */
export const PENDING_TX_TRAINS = TRAINS.filter((train) => trainHasFixture(train, 'pending-transactions'));

export type FixtureName =
  | 'shielded'
  | 'shielded-receiver'
  | 'shielded-pending'
  | 'shielded-deep'
  | 'unshielded'
  | 'unshielded-minimal'
  | 'dust'
  | 'tx-history'
  | 'pending-transactions';

export const loadFixture = (train: string, name: FixtureName): Fixture => {
  const url = new URL(`../fixtures/${train}/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Fixture;
};

/** Fixed scenario values the generator used; see fixture-generator/chainDriver.mjs. */
export const TOKEN_A = '11'.repeat(32);
export const TOKEN_B = '22'.repeat(32);
export const CUSTOM_UNSHIELDED = '33'.repeat(32);
export const TRANSFER_VALUE = 120n;
export const SENDER_COIN_VALUES_A = [100n, 130n, 400n] as const; // 130n = 250n change after the 120n transfer
export const SENDER_BALANCE_A = 630n;
export const SENDER_BALANCE_B = 5000n;
export const NIGHT_VALUE = 1_000_000n;
export const CUSTOM_UNSHIELDED_VALUE = 777n;
export const UNSHIELDED_PENDING_VALUE = 4200n;
