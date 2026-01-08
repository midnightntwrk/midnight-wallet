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
import { sampleIntentHash } from '@midnight-ntwrk/ledger-v7';
import * as rx from 'rxjs';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { UnshieldedUpdate, UtxoWithMeta } from '../src/v1/SyncSchema.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DefaultV1Configuration } from '../src/v1/index.js';
import { InMemoryTransactionHistoryStorage } from '../src/storage/index.js';
import { UnshieldedWallet, UnshieldedWalletState } from '../src/UnshieldedWallet.js';

/**
 * TODO: place in separate package with more additional mock functions
 */
export const generateMockTransaction = (
  owner: string,
  type: string,
  applyStage: 'SUCCESS' | 'FAILURE',
  createdOutputsAmount: number,
  spentOutputsAmount: number,
): UnshieldedUpdate => {
  const createdUtxos = Array.from({ length: createdOutputsAmount }, () => generateMockUtxoWithMeta(owner, type));
  const spentUtxos = Array.from({ length: spentOutputsAmount }, () => generateMockUtxoWithMeta(owner, type));

  return {
    type: 'UnshieldedTransaction',
    transaction: {
      id: Math.floor(Math.random() * 1000),
      hash: crypto.randomUUID(),
      type: 'RegularTransaction',
      protocolVersion: 1,
      identifiers: createdUtxos.map((u) => u.utxo.intentHash),
      block: {
        timestamp: new Date(),
      },
      fees: {
        paidFees: 0n,
        estimatedFees: 0n,
      },
      transactionResult: {
        status: applyStage,
        segments: [{ id: 1, success: applyStage === 'SUCCESS' }],
      },
    },
    createdUtxos,
    spentUtxos,
    status: applyStage,
  };
};

export const generateMockUtxoWithMeta = (owner: string, type: string): UtxoWithMeta => ({
  utxo: {
    value: BigInt(Math.ceil(Math.random() * 100)),
    owner,
    type,
    intentHash: sampleIntentHash(),
    outputNo: Math.floor(Math.random() * 100),
  },
  meta: {
    ctime: new Date(),
    registeredForDustGeneration: true,
  },
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

/**
 * Creates a default wallet configuration for testing.
 * This encapsulates the common configuration pattern used across tests.
 *
 * @param indexerPort - The port number for the indexer service
 * @param overrides - Optional partial configuration to override defaults
 * @returns A complete DefaultV1Configuration object
 */
export const createWalletConfig = (
  indexerPort: number,
  overrides?: Partial<DefaultV1Configuration>,
): DefaultV1Configuration => {
  const defaultConfig: DefaultV1Configuration = {
    indexerClientConnection: {
      indexerWsUrl: `ws://localhost:${indexerPort}/api/v3/graphql/ws`,
      indexerHttpUrl: `http://localhost:${indexerPort}/api/v3/graphql`,
    },
    networkId: NetworkId.NetworkId.Undeployed,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };

  return { ...defaultConfig, ...overrides };
};

export const waitForCoins = (wallet: UnshieldedWallet): Promise<UnshieldedWalletState<string>> => {
  return rx.firstValueFrom(wallet.state.pipe(rx.filter((state) => state.availableCoins.length > 0)));
};
