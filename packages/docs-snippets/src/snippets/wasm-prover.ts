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
/*
 * Proving in this process, either side of a protocol boundary.
 *
 * The bundled prover drives a zkir runtime over bytes and never looks at a ledger version, so — unlike a proof server,
 * which is built against one — the same description serves both ledger versions. Naming it under both `v8` and `v9`
 * covers the whole timeline: the SDK drives each side with its own ledger, and where one side ends and the other
 * begins is `forks.v9`, which the facade presets.
 */
import {
  WalletSeeds,
  type DefaultConfiguration,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
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
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  // The in-process prover, for every ledger version. `keyMaterialProvider` can be supplied here to point the prover
  // at key material of your own; left out, it reads the published circuits, which both ledger versions accept.
  provers: { v8: { kind: 'wasm' }, v9: { kind: 'wasm' } },
  indexerClientConnection: {
    indexerHttpUrl: INDEXER_HTTP_URL,
    indexerWsUrl: INDEXER_WS_URL,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
};

const initWalletWithSeed = async (seed: Buffer) => {
  // One master seed, three wallet seeds. A seed is the only key material that crosses a protocol boundary, so this is
  // what lets one wallet follow the chain through a fork.
  const seeds = WalletSeeds.fromMasterSeed(seed);
  const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, configuration.networkId);

  const wallet: WalletFacade = await WalletFacade.init({
    configuration,
    shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
  });

  await wallet.start(seeds);

  return { wallet, seeds, unshieldedKeystore };
};

const { wallet } = await initWalletWithSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);
const syncedState = await wallet.waitForSyncedState();
console.log('Synced state:');
console.dir(
  {
    shielded: pick(syncedState.shielded, [
      'balances',
      'availableCoins',
      'pendingCoins',
      'totalCoins',
      'progress',
      'coinPublicKey',
      'encryptionPublicKey',
      'address',
    ]),
    unshielded: pick(syncedState.unshielded, [
      'balances',
      'availableCoins',
      'pendingCoins',
      'totalCoins',
      'progress',
      'address',
    ]),
    dust: pick(syncedState.dust, ['totalCoins', 'availableCoins', 'pendingCoins', 'progress', 'publicKey', 'address']),
  },
  { depth: null },
);
await wallet.stop();
