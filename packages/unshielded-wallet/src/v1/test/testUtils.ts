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
import { UnshieldedUpdate, UpdateStatus, UtxoWithMeta } from '../UnshieldedState.js';

export const generateMockUtxoWithMeta = (owner: string, type: string): UtxoWithMeta =>
  new UtxoWithMeta({
    utxo: generateMockLedgerUtxo(owner, type),
    meta: {
      ctime: new Date(),
      registeredForDustGeneration: true,
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
  const createdUtxos = Array.from({ length: createdOutputsAmount }, () => generateMockUtxoWithMeta(owner, type));
  const spentUtxos = Array.from({ length: spentOutputsAmount }, () => generateMockUtxoWithMeta(owner, type));

  return {
    createdUtxos,
    spentUtxos,
    status,
  };
};

/**
 * Deterministic UTxO factory. Unlike generateMockUtxoWithMeta, all fields can
 * be pinned, so tests can assert membership by hash (intentHash#outputNo).
 */
export const makeUtxo = (params: {
  intentHash: string;
  outputNo: number;
  owner?: string;
  type?: string;
  value?: bigint;
  ctime?: Date;
  registeredForDustGeneration?: boolean;
}): UtxoWithMeta =>
  new UtxoWithMeta({
    utxo: {
      value: params.value ?? 1n,
      owner: params.owner ?? 'owner1',
      type: params.type ?? 'type1',
      intentHash: params.intentHash,
      outputNo: params.outputNo,
    },
    meta: {
      ctime: params.ctime ?? new Date(0),
      registeredForDustGeneration: params.registeredForDustGeneration ?? true,
    },
  });

/**
 * Hash of a UtxoWithMeta matching UnshieldedState's internal UtxoHash.
 * Exposed for tests that assert by hash.
 */
export const utxoHash = (u: UtxoWithMeta): string => `${u.utxo.intentHash}#${u.utxo.outputNo}`;

/**
 * fast-check arbitrary for UtxoWithMeta. Each generated UTxO has a unique
 * hash (the generator uses fc.uuid for intentHash), so fc.array(utxoArb)
 * never produces collisions.
 */
export const utxoArb: fc.Arbitrary<UtxoWithMeta> = fc
  .record({
    intentHash: fc.uuid(),
    outputNo: fc.integer({ min: 0, max: 1_000_000 }),
    value: fc.bigInt({ min: 1n, max: 1000n }),
    owner: fc.constantFrom('owner1', 'owner2'),
    type: fc.constantFrom('type1', 'type2'),
  })
  .map((p) => makeUtxo(p));

export const seedHex = (length: number = 64, seed: number = 42): string =>
  Array.from({ length }, (_, i) => ((seed + i) % 16).toString(16)).join('');

export const blockTime = (blockTime: Date): bigint => BigInt(Math.ceil(+blockTime / 1000));
