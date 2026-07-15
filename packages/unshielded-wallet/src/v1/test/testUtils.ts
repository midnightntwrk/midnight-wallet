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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as fc from 'fast-check';
import { type UnshieldedUpdate, type UpdateStatus, UtxoWithMeta } from '../UnshieldedState.js';

export type UtxoOverrides = {
  owner?: string;
  type?: string;
  value?: bigint;
  intentHash?: string;
  outputNo?: number;
  ctime?: Date;
  registeredForDustGeneration?: boolean;
};

/**
 * UtxoWithMeta factory. All fields have defaults so tests can opt into determinism (pin intentHash/outputNo) or rely on
 * random values for fields they do not care about. Tests that assert membership by hash should pin intentHash and
 * outputNo.
 */
export const generateMockUtxoWithMeta = (overrides: UtxoOverrides = {}): UtxoWithMeta =>
  new UtxoWithMeta({
    utxo: {
      value: overrides.value ?? BigInt(Math.ceil(Math.random() * 100)),
      owner: overrides.owner ?? 'owner1',
      type: overrides.type ?? 'type1',
      intentHash: overrides.intentHash ?? ledger.sampleIntentHash(),
      outputNo: overrides.outputNo ?? Math.floor(Math.random() * 100),
    },
    meta: {
      ctime: overrides.ctime ?? new Date(),
      registeredForDustGeneration: overrides.registeredForDustGeneration ?? true,
    },
  });

export const generateMockLedgerUtxo = (owner: string, type: string): ledger.Utxo => ({
  value: BigInt(Math.ceil(Math.random() * 100)),
  owner,
  type,
  intentHash: ledger.sampleIntentHash(),
  outputNo: Math.floor(Math.random() * 100),
});

export const generateMockUpdate = (
  status: UpdateStatus,
  createdOutputsAmount: number,
  spentOutputsAmount: number,
  owner: string = 'owner1',
  type: string = 'type1',
): UnshieldedUpdate => {
  const createdUtxos = Array.from({ length: createdOutputsAmount }, () => generateMockUtxoWithMeta({ owner, type }));
  const spentUtxos = Array.from({ length: spentOutputsAmount }, () => generateMockUtxoWithMeta({ owner, type }));

  return {
    createdUtxos,
    spentUtxos,
    status,
  };
};

/** Hash of a UtxoWithMeta matching UnshieldedState's internal UtxoHash. Exposed for tests that assert by hash. */
export const utxoHash = (u: UtxoWithMeta): string => `${u.utxo.intentHash}#${u.utxo.outputNo}`;

/**
 * Fast-check arbitrary for UtxoWithMeta. Each generated UTxO has a unique hash (the generator uses fc.uuid for
 * intentHash), so fc.array(utxoArb) never produces collisions.
 */
export const utxoArb: fc.Arbitrary<UtxoWithMeta> = fc
  .record({
    intentHash: fc.uuid(),
    outputNo: fc.integer({ min: 0, max: 1_000_000 }),
    value: fc.bigInt({ min: 1n, max: 1000n }),
    owner: fc.constantFrom('owner1', 'owner2'),
    type: fc.constantFrom('type1', 'type2'),
  })
  .map((p) => generateMockUtxoWithMeta(p));

export const seedHex = (length: number = 64, seed: number = 42): string =>
  Array.from({ length }, (_, i) => ((seed + i) % 16).toString(16)).join('');

export const blockTime = (blockTime: Date): bigint => BigInt(Math.ceil(+blockTime / 1000));
