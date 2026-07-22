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
import {
  type DefaultConfiguration,
  CustomDustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  PublicKey,
  Roles,
  ShieldedWallet,
  createKeystore,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
} from '@midnightntwrk/wallet-sdk';
import { V1Builder } from '@midnightntwrk/wallet-sdk/dust/v1';
import { makeEventLessSyncCapability, makeEventLessSyncService } from '@midnightntwrk/wallet-sdk-dust-fast-sync';
import { Buffer } from 'buffer';

const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);

const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  provingServerUrl: new URL(`http://localhost:${PROOF_SERVER_PORT}`),
  indexerClientConnection: {
    indexerHttpUrl: `http://localhost:${INDEXER_PORT}/api/v4/graphql`,
    indexerWsUrl: `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
};

const seed = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');
const hdWallet = HDWallet.fromSeed(seed);

if (hdWallet.type !== 'seedOk') {
  throw new Error('Failed to initialize HDWallet');
}

const derivationResult = hdWallet.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);

if (derivationResult.type !== 'keysDerived') {
  throw new Error('Failed to derive keys');
}

hdWallet.hdWallet.clear();

const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
const dustKeySeed = derivationResult.keys[Roles.Dust];
const dustSecretKey = ledger.DustSecretKey.fromSeed(dustKeySeed);
const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], configuration.networkId);

const fastSyncBuilder = new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability);

const wallet = await WalletFacade.init({
  configuration,
  shielded: (config) => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
  unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (config) =>
    CustomDustWallet(
      // Fast sync uses a separate ledger WASM instance, so it needs the seed to re-derive the same Dust key.
      { ...config, dustKeySeed },
      fastSyncBuilder,
    ).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
});

// The Dust wallet starts the injected projections-based sync service in the background.
await wallet.start(shieldedSecretKeys, dustSecretKey);
await wallet.waitForSyncedState();

console.log('Fast Dust sync completed');
await wallet.stop();
