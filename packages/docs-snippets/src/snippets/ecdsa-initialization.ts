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
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  type DefaultConfiguration,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
  HDWallet,
  Roles,
  ShieldedWallet,
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk';
import { Buffer } from 'buffer';
import { pick } from 'lodash-es';

const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  provingServerUrl: new URL(`http://localhost:${PROOF_SERVER_PORT}`),
  indexerClientConnection: {
    indexerHttpUrl: INDEXER_HTTP_URL,
    indexerWsUrl: INDEXER_WS_URL,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
};

const initEcdsaWalletWithSeed = async (seed: Buffer) => {
  const hdWallet = HDWallet.fromSeed(seed);

  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet');
  }

  // ECDSA unshielded keys live under their own HD role (4), so the scalar is
  // never shared with the Schnorr roles (0/1) derived from the same account.
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.EcdsaUnshielded, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }

  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  // The keystore kind selects the signature scheme; an ECDSA key hashes to a
  // different address than a Schnorr key, so UTXOs owned by this wallet can
  // only ever be spent with ECDSA signatures.
  const unshieldedKeystore = createKeystore(
    { kind: 'ecdsa', secret: derivationResult.keys[Roles.EcdsaUnshielded] },
    configuration.networkId,
  );

  const wallet: WalletFacade = await WalletFacade.init({
    configuration,
    shielded: (config) => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) =>
      DustWallet(config).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

const { wallet, unshieldedKeystore } = await initEcdsaWalletWithSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);

console.log('ECDSA verifying key:', unshieldedKeystore.getPublicKey());
console.log('ECDSA unshielded address:', unshieldedKeystore.getBech32Address().asString());

const syncedState = await wallet.waitForSyncedState();
console.log('Synced state:');
console.dir(
  {
    unshielded: pick(syncedState.unshielded, [
      'balances',
      'availableCoins',
      'pendingCoins',
      'totalCoins',
      'progress',
      'address',
    ]),
  },
  { depth: null },
);
await wallet.stop();
