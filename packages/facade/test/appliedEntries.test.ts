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

/**
 * A wallet records a transaction it has applied before it knows the transaction's details, and the facade's history
 * keeps that entry, and each wallet's "details pending" flag on it, until the details arrive.
 *
 * @remarks
 *   The wallets write into the storage their factories are handed, which the facade wraps; the wrapper must pass the
 *   applied-entry write through, or the wallets fall back to writing only once the indexer answers. The facade's entry
 *   schema must declare each wallet's flag, or a saved history drops it and a restored wallet never completes the
 *   entry.
 */

import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  type TransactionHistoryStorage,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ResolvedConfiguration,
  type WalletEntry,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../src/index.js';
import { createV8MockProvingService, getDustSeed, getShieldedSeed, getUnshieldedSeed } from './utils/index.js';

const configurationWith = (
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>,
): ResolvedConfiguration => ({
  networkId: NetworkId.NetworkId.Undeployed,
  forks: { v9: ProtocolVersion.V9NativeForkVersion },
  relayURL: new URL('http://localhost:9944'),
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
  provingServerUrl: new URL('http://localhost:6300'),
  costParameters: { feeBlocksMargin: 0 },
  txHistoryStorage,
});

const historyStorage = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);

// Built as plain values rather than inline literals: they carry each wallet's flag, which the wallets' own entry types
// declare and this test reads back from the facade's history.
const shieldedApplied = {
  hash: 'tx',
  identifiers: [],
  protocolVersion: 1,
  shielded: { receivedCoins: [], spentCoins: [] },
  shieldedDetailsPending: true,
};
const dustApplied = {
  hash: 'tx',
  identifiers: [],
  protocolVersion: 1,
  dust: { receivedUtxos: [], spentUtxos: [] },
  dustDetailsPending: true,
};

describe('the storage the facade hands its wallets', () => {
  let facade: WalletFacade | undefined;

  afterEach(async () => {
    await facade?.stop();
  });

  it('should record an applied entry in the configured history, so the wallets can store it before their state moves', async () => {
    const configuration = configurationWith(historyStorage());
    const seed = '0000000000000000000000000000000000000000000000000000000000000005';
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, configuration.networkId);
    // Real, shipped wallets, never started: this test writes what their sync would, through the storage they are handed.
    const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
    const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = await DustWallet(configuration).startWithSeed(
      getDustSeed(seed),
      ledgerV9.LedgerParameters.initialParameters().dust,
    );
    const handed: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>[] = [];
    facade = await WalletFacade.init({
      configuration,
      shielded: (walletsConfiguration) => {
        // Test setup: the factory is a callback, so the storage it is handed is collected outside the facade.
        handed.push(walletsConfiguration.txHistoryStorage);
        return shielded;
      },
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
    });
    const [walletsStorage] = handed;

    expect(walletsStorage !== undefined && 'gotApplied' in walletsStorage).toBe(true);
    await walletsStorage?.gotApplied?.(shieldedApplied);

    expect(await configuration.txHistoryStorage.get('tx')).toMatchObject({
      lifecycle: { status: 'finalized' },
      shieldedDetailsPending: true,
    });
  });
});

describe('a facade history holding entries whose details are pending', () => {
  it('should keep each wallet’s pending flag through serialize and restore', async () => {
    const storage = historyStorage();
    await storage.gotApplied(shieldedApplied);
    await storage.gotApplied(dustApplied);

    const restored = InMemoryTransactionHistoryStorage.restore(
      await storage.serialize(),
      WalletEntrySchema,
      mergeWalletEntries,
    );

    expect(await restored.get('tx')).toMatchObject({
      lifecycle: { status: 'finalized' },
      shieldedDetailsPending: true,
      dustDetailsPending: true,
      shielded: { receivedCoins: [], spentCoins: [] },
      dust: { receivedUtxos: [], spentUtxos: [] },
    });
  });
});
