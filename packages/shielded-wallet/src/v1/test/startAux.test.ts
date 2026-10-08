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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage, NetworkId, WalletSeed } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { ShieldedTransactionHistoryEntrySchema } from '../TransactionHistory.js';
import { type DefaultV1Configuration, V1Builder } from '../V1Builder.js';

const configuration: DefaultV1Configuration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://unused:0' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(ShieldedTransactionHistoryEntrySchema),
};

const seed = WalletSeed.fromString('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');

describe('start-aux capability', () => {
  it('derives this ledger version s secret keys from a seed', () => {
    const variant = new V1Builder().withDefaults().build(configuration);
    const expected = ledger.ZswapSecretKeys.fromSeed(seed);

    const derived = variant.startAux.fromSeed(seed);

    expect(derived.coinPublicKey).toBe(expected.coinPublicKey);
    expect(derived.encryptionPublicKey).toBe(expected.encryptionPublicKey);
  });

  it('derives different key material from a different seed', () => {
    const variant = new V1Builder().withDefaults().build(configuration);
    const otherSeed = WalletSeed.fromString('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100');

    expect(variant.startAux.fromSeed(seed).coinPublicKey).not.toBe(variant.startAux.fromSeed(otherSeed).coinPublicKey);
  });

  it('lets a builder supply its own derivation', () => {
    const fixed = ledger.ZswapSecretKeys.fromSeed(
      WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001'),
    );
    const variant = new V1Builder()
      .withDefaults()
      .withStartAux({ fromSeed: () => fixed })
      .build(configuration);

    expect(variant.startAux.fromSeed(seed).coinPublicKey).toBe(fixed.coinPublicKey);
  });
});
