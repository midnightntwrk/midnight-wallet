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
import { sampleIntentHash } from '@midnight-ntwrk/ledger-v6';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { UnshieldedTransaction, Utxo } from '@midnight-ntwrk/wallet-sdk-unshielded-state';

/**
 * TODO: place in separate package with more additional mock functions
 */
export const generateMockTransaction = (
  owner: string,
  type: string,
  applyStage: 'SucceedEntirely' | 'FailEntirely',
  createdOutputsAmount: number,
  spentOutputsAmount: number,
): UnshieldedTransaction => {
  const createdOutputs = Array.from({ length: createdOutputsAmount }, () => generateMockUtxo(owner, type));

  const spentOutputs = Array.from({ length: spentOutputsAmount }, () => generateMockUtxo(owner, type));

  return {
    id: Math.floor(Math.random() * 1000),
    hash: crypto.randomUUID(),
    type: 'RegularTransaction',
    identifiers: createdOutputs.map((output) => output.intentHash),
    createdUtxos: createdOutputs,
    spentUtxos: spentOutputs,
    protocolVersion: 1,
    transactionResult: {
      status: applyStage,
      segments: [{ id: '1', success: true }],
    },
  };
};

export const generateMockUtxo = (owner: string, type: string): Utxo => ({
  value: BigInt(Math.ceil(Math.random() * 100)),
  owner,
  type: type,
  intentHash: sampleIntentHash(),
  outputNo: Math.floor(Math.random() * 100),
  ctime: Date.now(),
  registeredForDustGeneration: true,
});

export const seedHex = (length: number = 64, seed: number = 42): string =>
  Array.from({ length }, (_, i) => ((seed + i) % 16).toString(16)).join('');

export const blockTime = (blockTime: Date): bigint => BigInt(Math.ceil(+blockTime / 1000));

export const getUnshieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return Buffer.from(derivationResult.key);
};
