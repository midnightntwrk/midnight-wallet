// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { type UnshieldedUpdate, type UpdateStatus, UtxoWithMeta } from '../UnshieldedState.js';

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

export const seedHex = (length: number = 64, seed: number = 42): string =>
  Array.from({ length }, (_, i) => ((seed + i) % 16).toString(16)).join('');

export const blockTime = (blockTime: Date): bigint => BigInt(Math.ceil(+blockTime / 1000));
