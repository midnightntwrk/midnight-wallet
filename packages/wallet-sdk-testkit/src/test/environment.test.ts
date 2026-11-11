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
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { createRemoteEnvironment, parseMidnightNetwork } from '../environment.js';

describe('parseMidnightNetwork', () => {
  it.each(['undeployed', 'qanet', 'devnet', 'preview', 'preprod', 'stagenet'] as const)('should read %s', (network) => {
    expect(parseMidnightNetwork(network)).toBe(network);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['an unknown name', 'mainnet'],
    ['a different case', 'Preview'],
  ])(
    'should reject a network that is %s, naming it, rather than fail later on endpoints it has no preset for',
    (_case, raw) => {
      expect(() => parseMidnightNetwork(raw)).toThrow(`Unrecognized network: ${String(raw)}`);
    },
  );
});

describe('createRemoteEnvironment', () => {
  it.each(['qanet', 'devnet', 'preview', 'preprod', 'stagenet'] as const)(
    'should serve the %s indexer websocket from the same host as its HTTP endpoint, so subscriptions and queries reach one indexer',
    (network) => {
      const { endpoints } = createRemoteEnvironment({ network, proverUrl: 'http://localhost:6300' });

      expect(new URL(endpoints.indexerWsUrl).host).toBe(new URL(endpoints.indexerHttpUrl).host);
    },
  );

  // Written out rather than read from the presets, so a mistyped or retired host fails here instead of being copied in.
  it.each([
    [
      'devnet',
      {
        networkId: NetworkId.NetworkId.DevNet,
        indexerHttpUrl: 'https://indexer.devnet.shielded.tools/api/v4/graphql',
        indexerWsUrl: 'wss://indexer.devnet.shielded.tools/api/v4/graphql/ws',
        nodeUrl: 'wss://rpc.devnet.shielded.tools',
      },
    ],
    [
      'qanet',
      {
        networkId: NetworkId.NetworkId.QaNet,
        indexerHttpUrl: 'https://indexer.qanet.shielded.tools/api/v4/graphql',
        indexerWsUrl: 'wss://indexer.qanet.shielded.tools/api/v4/graphql/ws',
        nodeUrl: 'wss://rpc.qanet.shielded.tools',
      },
    ],
    [
      'preview',
      {
        networkId: NetworkId.NetworkId.Preview,
        indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
        indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
        nodeUrl: 'wss://rpc.preview.midnight.network',
      },
    ],
    [
      'preprod',
      {
        networkId: NetworkId.NetworkId.PreProd,
        indexerHttpUrl: 'https://indexer.preprod.shielded.tools/api/v4/graphql',
        indexerWsUrl: 'wss://indexer.preprod.shielded.tools/api/v4/graphql/ws',
        nodeUrl: 'wss://rpc.preprod.midnight.network',
      },
    ],
    [
      'stagenet',
      {
        networkId: NetworkId.NetworkId.StageNet,
        indexerHttpUrl: 'https://indexer.stagenet.shielded.tools/api/v4/graphql',
        indexerWsUrl: 'wss://indexer.stagenet.shielded.tools/api/v4/graphql/ws',
        nodeUrl: 'wss://rpc.stagenet.shielded.tools',
      },
    ],
  ] as const)(
    "should resolve the %s preset to that network's published endpoints, so a run reaches its indexer and node",
    (network, expected) => {
      const proverUrl = 'http://localhost:6300';

      expect(createRemoteEnvironment({ network, proverUrl }).endpoints).toEqual({ ...expected, proverUrl });
    },
  );
});
