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
import {
  type DefaultConfiguration,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
  Roles,
  ShieldedWallet,
  WalletSeeds,
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
// The proof server built against ledger-v8, for the chain's history below `forks.v9`. Never contacted on a chain
// that has been on ledger-v9 since genesis, like the one this runs against.
const V8_PROOF_SERVER_PORT = Number.parseInt(process.env['V8_PROOF_SERVER_PORT'] ?? '6301', 10);
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  // One proof server per ledger version, keyed the way `forks` is: `v8` answers below `forks.v9`, `v9` from it. A
  // transaction is proved by the backend for the ledger version that authored its bytes, so the wallet proves on either
  // side of the fork and across it. `hard-fork-support.ts` explains the shape in full.
  provers: {
    v8: { kind: 'server', url: new URL(`http://localhost:${V8_PROOF_SERVER_PORT}`) },
    v9: { kind: 'server', url: new URL(`http://localhost:${PROOF_SERVER_PORT}`) },
  },
  indexerClientConnection: {
    indexerHttpUrl: INDEXER_HTTP_URL,
    indexerWsUrl: INDEXER_WS_URL,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
};

const initEcdsaWalletWithSeed = async (seed: Buffer) => {
  // ECDSA unshielded keys live under their own HD role (4), so the scalar is
  // never shared with the Schnorr roles (0/1) derived from the same account.
  const seeds = WalletSeeds.fromMasterSeed(seed, { unshieldedRole: Roles.EcdsaUnshielded });
  // The keystore kind selects the signature scheme; an ECDSA key hashes to a
  // different address than a Schnorr key, so UTXOs owned by this wallet can
  // only ever be spent with ECDSA signatures.
  const unshieldedKeystore = createKeystore({ kind: 'ecdsa', secret: seeds.unshielded }, configuration.networkId);

  const wallet: WalletFacade = await WalletFacade.init({
    configuration,
    shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
  });

  await wallet.start(seeds);

  return { wallet, seeds, unshieldedKeystore };
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
