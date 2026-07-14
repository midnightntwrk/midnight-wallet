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
import { readFileSync } from 'node:fs';

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

export const TRAINS = ['facade-1.0.0', 'facade-2.0.0', 'facade-3.0.0', 'facade-4.0.0', 'facade-4.1.0'] as const;

export type Train = (typeof TRAINS)[number];

/** Trains that include a tx-history payload (the storage layer only exists from T4 on). */
export const TX_HISTORY_TRAINS = ['facade-4.0.0', 'facade-4.1.0'] as const;

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
