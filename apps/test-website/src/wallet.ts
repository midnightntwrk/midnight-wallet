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
  type UnshieldedKeystore,
  UnshieldedWallet,
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
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}> => {
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
      DustWallet(config).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};
