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
import { InMemoryTransactionHistoryStorage, NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import {
  type DustWalletConfiguration,
  type MidnightNetwork,
  type RemoteNetwork,
  type ResolvedEndpoints,
  type WalletConfiguration,
  type WalletTestEnvironment,
} from './types.js';

/** Public service endpoints for each remote network, minus the (caller-supplied) prover URL. */
export type RemoteNetworkPreset = Omit<ResolvedEndpoints, 'proverUrl'>;

/**
 * Endpoint presets lifted verbatim from the old `TestContainersFixture` getters. The proof server is intentionally
 * absent — there is no public prover, so every remote environment must be told where to find one.
 */
export const NETWORK_PRESETS: Record<RemoteNetwork, RemoteNetworkPreset> = {
  devnet: {
    networkId: NetworkId.NetworkId.DevNet,
    indexerHttpUrl: 'https://indexer.devnet.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.devnet.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.devnet.midnight.network',
  },
  qanet: {
    networkId: NetworkId.NetworkId.QaNet,
    indexerHttpUrl: 'https://indexer.qanet.midnight.network/api/v4/graphql',
    // NB: qanet ws is served from the `indexer-blue` host — preserved from upstream.
    indexerWsUrl: 'wss://indexer-blue.qanet.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.qanet.midnight.network',
  },
  preview: {
    networkId: NetworkId.NetworkId.Preview,
    indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.preview.midnight.network',
  },
  preprod: {
    networkId: NetworkId.NetworkId.PreProd,
    indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.preprod.midnight.network',
  },
  stagenet: {
    networkId: NetworkId.NetworkId.StageNet,
    indexerHttpUrl: 'https://indexer.stagenet.shielded.tools/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.stagenet.shielded.tools/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.stagenet.shielded.tools',
  },
};

/**
 * Builds a {@link WalletTestEnvironment} from already-resolved endpoints. Shared by the remote factory below and the
 * testcontainers factory (which resolves endpoints from mapped ports first). The two `get*Config` builders are
 * byte-for-byte the behaviour of the old fixture, except the URLs come from `endpoints` instead of `process.env` /
 * container introspection.
 */
export const makeEnvironment = (
  network: MidnightNetwork,
  endpoints: ResolvedEndpoints,
  options: { down?: () => Promise<void> } = {},
): WalletTestEnvironment => ({
  network,
  endpoints,
  getWalletConfig(): WalletConfiguration {
    return {
      indexerClientConnection: {
        indexerHttpUrl: endpoints.indexerHttpUrl,
        indexerWsUrl: endpoints.indexerWsUrl,
      },
      provingServerUrl: new URL(endpoints.proverUrl),
      relayURL: new URL(endpoints.nodeUrl),
      networkId: endpoints.networkId,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
  },
  getDustWalletConfig(): DustWalletConfiguration {
    return {
      networkId: endpoints.networkId,
      costParameters: {
        feeBlocksMargin: 5,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      indexerClientConnection: {
        indexerHttpUrl: endpoints.indexerHttpUrl,
      },
    };
  },
  down: options.down ?? (async () => {}),
});

/** Configuration for {@link createRemoteEnvironment}. */
export interface RemoteEnvironmentConfig {
  /** Which remote network's endpoint preset to start from. */
  network: RemoteNetwork;
  /** Proof-server base URL. Required — there is no public prover. */
  proverUrl: string;
  /**
   * Optional endpoint overrides. Use this to point at an internal indexer/node (e.g. a monitoring deployment that
   * proxies the public ones) without abandoning the preset for the rest.
   */
  endpoints?: Partial<Omit<ResolvedEndpoints, 'proverUrl'>>;
}

/**
 * Creates a no-Docker environment pointed at an already-running network.
 *
 * This is the path downstream consumers (e.g. sentinel monitoring) use: supply a prover URL and a network preset, get
 * back the same `WalletTestEnvironment` the local testcontainers stack produces — with no testcontainers dependency
 * loaded and no `process.env` patching required.
 */
export const createRemoteEnvironment = (config: RemoteEnvironmentConfig): WalletTestEnvironment => {
  if (!config.proverUrl) {
    throw new Error('createRemoteEnvironment: `proverUrl` is required (there is no public proof server).');
  }
  const preset = NETWORK_PRESETS[config.network];
  const endpoints: ResolvedEndpoints = {
    networkId: config.endpoints?.networkId ?? preset.networkId,
    proverUrl: config.proverUrl,
    indexerHttpUrl: config.endpoints?.indexerHttpUrl ?? preset.indexerHttpUrl,
    indexerWsUrl: config.endpoints?.indexerWsUrl ?? preset.indexerWsUrl,
    nodeUrl: config.endpoints?.nodeUrl ?? preset.nodeUrl,
  };
  return makeEnvironment(config.network, endpoints);
};
