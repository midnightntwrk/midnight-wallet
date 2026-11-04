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
import { makeEnvironment, NETWORK_PRESETS, parseMidnightNetwork } from '../environment.js';

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

describe('makeEnvironment', () => {
  const endpoints = {
    networkId: NetworkId.NetworkId.Undeployed,
    proverUrl: 'http://localhost:6300',
    indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
    indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    nodeUrl: 'ws://localhost:9944',
  };

  it.each(['undeployed', 'qanet'] as const)(
    'should configure the %s dust wallet to skip the ledger-v8 dust history, so a fresh wallet on a network that crossed the v9 fork does not replay it',
    (network) => {
      // Every healthcheck wallet starts through this configuration; without the skip, its first Dust sync on a
      // long-lived network spends the whole cold sync replaying ledger-v8 dust events.
      expect(makeEnvironment(network, endpoints).getDustWalletConfig().skipLedgerV8DustHistory).toBe(true);
    },
  );
});

describe('NETWORK_PRESETS', () => {
  it.each(Object.entries(NETWORK_PRESETS))(
    'should serve the %s indexer subscription from the host its queries go to, so a wallet given both URLs connects',
    (_network, preset) => {
      // A wallet handed an explicit WebSocket URL uses it as given. Pointing it at a host that does not serve the
      // subscription leaves the wallet never connected and never synced, with nothing failing to say why.
      expect(new URL(preset.indexerWsUrl).host).toBe(new URL(preset.indexerHttpUrl).host);
    },
  );
});
