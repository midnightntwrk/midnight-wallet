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
  type DefaultDustConfiguration,
  CustomDustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
  HDWallet,
  Roles,
  ShieldedWallet,
  createKeystore,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
  PublicKey,
  UnshieldedWallet,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk';
import { V1Builder } from '@midnightntwrk/wallet-sdk/dust/v1';
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

// The default dust wallet replays the full ledger event history. Projections-based "fast sync"
// instead reads the indexer's dust projections — the wallet's generation entries as a snapshot
// at a block hash, plus spends matched by nullifier prefix — so the initial sync scales with
// the wallet's own activity rather than chain length.
//
// `anonymityLevel` tunes the nullifier prefixes revealed to the indexer: the prefix is chosen
// so the wallet hides among roughly 2^anonymityLevel candidate nullifiers (default 7). Raising
// it improves privacy but downloads more non-matching candidates to filter out locally.
const fastSyncDustWallet = (config: DefaultDustConfiguration) =>
  CustomDustWallet(
    { ...config, anonymityLevel: 7 },
    new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
  );

const initWalletWithSeed = async (seed: Buffer) => {
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
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    { kind: 'schnorr', secret: derivationResult.keys[Roles.NightExternal] },
    configuration.networkId,
  );

  const wallet: WalletFacade = await WalletFacade.init({
    configuration,
    shielded: (config) => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) =>
      fastSyncDustWallet(config).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  // The fast-syncing dust wallet joins background synchronization like any other; pass
  // `manualSync: true` as the third argument and drive it with `wallet.doSync(dustSecretKey)`
  // to control when snapshots are taken instead.
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

const { wallet } = await initWalletWithSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);
const syncedState = await wallet.waitForSyncedState();
console.log('Dust state after projections-based fast sync:');
console.dir(
  pick(syncedState.dust, ['totalCoins', 'availableCoins', 'pendingCoins', 'progress', 'publicKey', 'address']),
  { depth: null },
);
await wallet.stop();
