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
import { V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';
import {
  WalletSeeds,
  type DefaultConfiguration,
  type DefaultDustConfiguration,
  CustomDustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
  ShieldedWallet,
  createKeystore,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
  PublicKey,
  UnshieldedWallet,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk';
import { V2Builder } from '@midnightntwrk/wallet-sdk/dust/v2';
import { Buffer } from 'buffer';
import { pick } from 'lodash-es';

const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  // The protocol version this chain hands over to the post-fork ledger at. A 2.x node reports 2000000;
  // the final mainnet fork constant is not yet fixed, so this is supplied per environment.
  forkVersion: V9_NATIVE_FORK_VERSION,
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
//
// Note the `CustomDustWallet` composition: fast sync registers a SINGLE variant, and deliberately
// so. `DustWallet(config)` registers one variant either side of `forkVersion`, and the pre-fork
// variant has no projections path at all — it needs `DustLocalState` APIs no pre-fork ledger
// version has, permanently. A two-variant wallet therefore always begins on the event-replay
// variant and would only reach projections after migrating, which defeats the point. A wallet
// composed this way starts on the post-fork variant directly and cannot cross a fork; that is the
// trade this path makes.
const fastSyncDustWallet = (config: DefaultDustConfiguration) =>
  CustomDustWallet(
    { ...config, anonymityLevel: 7 },
    new V2Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
  );

const initWalletWithSeed = async (seed: Buffer) => {
  // One master seed, three wallet seeds. A seed is the only key material that crosses a protocol boundary, so this is
  // what lets one wallet follow the chain through a fork.
  const seeds = WalletSeeds.fromMasterSeed(seed);
  const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, configuration.networkId);

  const wallet: WalletFacade = await WalletFacade.init({
    configuration,
    shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) => fastSyncDustWallet(config).startWithSeed(seeds.dust),
  });

  // The fast-syncing dust wallet joins background synchronization like any other; pass
  // `manualSync: true` as the third argument and drive it with `wallet.doSync(seeds)`
  // to control when snapshots are taken instead.
  await wallet.start(seeds);

  return { wallet, seeds, unshieldedKeystore };
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
