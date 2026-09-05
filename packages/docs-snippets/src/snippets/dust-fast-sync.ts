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
  WalletSeeds,
  type DefaultConfiguration,
  type DefaultDustConfiguration,
  asPreForkDustParameters,
  CustomForkingDustWallet,
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
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk';
import { makeIndexerChainVersionProbe } from '@midnightntwrk/wallet-sdk/capabilities';
import { V1Builder } from '@midnightntwrk/wallet-sdk/dust/v1';
import { Migration, V2Builder } from '@midnightntwrk/wallet-sdk/dust/v2';
import * as ledger from '@midnightntwrk/wallet-sdk/ledger/v9';
import { Buffer } from 'buffer';
import { pick } from 'lodash-es';

const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);
// The proof server built against ledger-v8, for the chain's history below `forks.v9`. Never contacted on a chain
// that has been post-fork since genesis, like the one this runs against.
const V8_PROOF_SERVER_PORT = Number.parseInt(process.env['V8_PROOF_SERVER_PORT'] ?? '6301', 10);
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  // The protocol version this chain hands over to the post-fork ledger at. A 2.x node reports 2000000;
  // the final mainnet fork constant is not yet fixed, so this is supplied per environment.
  forks: { v9: ProtocolVersion.V9NativeForkVersion },
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  // One proof server per ledger version: the one built against ledger-v8 answers below `forks.v9`, the one built
  // against ledger-v9 from it. A transaction is proved by the entry for the version its bytes were authored at, so the
  // wallet proves on either side of the fork and across it. `hard-fork-support.ts` explains the shape in full.
  provers: [
    {
      sinceVersion: ProtocolVersion.MinSupportedVersion,
      backend: { kind: 'server', url: new URL(`http://localhost:${V8_PROOF_SERVER_PORT}`) },
    },
    {
      sinceVersion: ProtocolVersion.V9NativeForkVersion,
      backend: { kind: 'server', url: new URL(`http://localhost:${PROOF_SERVER_PORT}`) },
    },
  ],
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
// Note the composition. `DustWallet(config)` registers the event-replay variant either side of `forks.v9`, and
// only the ledger-v9 side has a projections path — it rests on `DustLocalState` APIs no ledger-v8 has, permanently. So
// the fast-syncing wallet is put together from its two halves by hand, the way the shipped one is: the ledger-v8
// replay variant below the boundary, exactly as shipped, and from the boundary a ledger-v9 variant whose sync is the
// projections one. On a chain still below the fork it replays events; at the fork it hands its state over
// (`makeCrossLedgerMigration`) and every pass after that reads projections; on a chain past the fork since genesis —
// like the one this runs against — the probe starts it on the projections side from the first block.
const fastSyncDustWallet = (config: DefaultDustConfiguration) => {
  const dustParameters = config.dustParameters ?? ledger.LedgerParameters.initialParameters().dust;
  const withProbe: DefaultDustConfiguration = {
    ...config,
    chainVersionProbe: config.chainVersionProbe ?? makeIndexerChainVersionProbe(config),
  };
  return CustomForkingDustWallet(
    withProbe,
    {
      builder: new V1Builder().withDefaults(),
      // `dustParameters` is a WASM object of whichever ledger produced it, so the ledger-v8 variant is handed the
      // ledger-v8 rebuild of the same rates rather than the object itself.
      configuration: { ...config, dustParameters: asPreForkDustParameters(dustParameters) },
    },
    {
      builder: new V2Builder()
        .withDefaults()
        .withSync(makeEventLessSyncService, makeEventLessSyncCapability)
        // Restated because `withSync` drops it: a sync service names the key material it is started with, so choosing
        // one un-chooses the derivation from a seed the defaults had set. This service is started with the same
        // `DustSecretKey` the default one is, and a start from a seed needs the derivation by name on both sides.
        .withStartAuxDefaults()
        .withMigration(() => Migration.makeCrossLedgerMigration({ dustParameters })),
      configuration: { ...config, anonymityLevel: 7 },
    },
  );
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
