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
  type DefaultConfiguration,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
  ShieldedWallet,
  createKeystore,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
  WalletSeeds,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk';
import { type Buffer } from 'buffer';

const PROOF_SERVER_PORT = Number.parseInt(globalThis.process?.env?.['PROOF_SERVER_PORT'] ?? '6300', 10);
const LOCAL_INDEXER_PORT = 8088;
const LOCAL_NODE_PORT_RPC = 9944;

export const KNOWN_NETWORKS = ['preview', 'preprod', 'devnet', 'qanet', 'undeployed'] as const;
export type KnownNetwork = (typeof KNOWN_NETWORKS)[number];

const indexerHttpUrl = (network: KnownNetwork): string =>
  network === 'undeployed'
    ? `http://localhost:${LOCAL_INDEXER_PORT}/api/v4/graphql`
    : `https://indexer.${network}.midnight.network/api/v4/graphql`;

// qanet's ws endpoint lives on the blue deployment, unlike its http endpoint.
const indexerWsUrl = (network: KnownNetwork): string =>
  network === 'undeployed'
    ? `ws://localhost:${LOCAL_INDEXER_PORT}/api/v4/graphql/ws`
    : `wss://${network === 'qanet' ? 'indexer-blue.qanet' : `indexer.${network}`}.midnight.network/api/v4/graphql/ws`;

const relayUrl = (network: KnownNetwork): string =>
  network === 'undeployed' ? `ws://localhost:${LOCAL_NODE_PORT_RPC}` : `wss://rpc.${network}.midnight.network`;

export type Configuration = DefaultConfiguration;

export const configurationFor = (network: KnownNetwork): Configuration => ({
  networkId: network,
  // The protocol version this chain hands over to ledger-v9 at. A 2.x node reports 2000000;
  // the final mainnet fork constant is not yet fixed, so this is supplied per environment.
  forks: { v9: V9_NATIVE_FORK_VERSION },
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(relayUrl(network)),
  provingServerUrl: new URL(`http://localhost:${PROOF_SERVER_PORT}`),
  indexerClientConnection: {
    indexerHttpUrl: indexerHttpUrl(network),
    indexerWsUrl: indexerWsUrl(network),
  },
  batchUpdates: {
    size: 50,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
});

export const defaultConfiguration: Configuration = configurationFor('preview');

export const init = async (
  seed: Buffer,
  configuration: Configuration = defaultConfiguration,
): Promise<{
  wallet: WalletFacade;
  seeds: WalletSeeds;
  unshieldedKeystore: UnshieldedKeystore;
}> => {
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
