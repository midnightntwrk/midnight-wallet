/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) 2025 Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { type DefaultConfiguration, WalletFacade } from '../src/index.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, sleep } from './utils/index.js';
import { PendingTransactions } from '@midnight-ntwrk/wallet-sdk-capabilities/pendingTransactions';
import * as rx from 'rxjs';
import { finalizedTransactionTrait } from '../src/transaction.js';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

describe('Wallet Facade handling pending transactions', () => {
  let configuration: DefaultConfiguration;

  let facade: WalletFacade;
  let shielded: ShieldedWallet;
  let unshielded: UnshieldedWallet;
  let dust: DustWallet;
  beforeEach(async () => {
    configuration = {
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        additionalFeeOverhead: 0n,
        feeBlocksMargin: 0,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000001';
    const shieldedSeed = getShieldedSeed(seed);
    const unshieldedSeed = getUnshieldedSeed(seed);
    const dustSeed = getDustSeed(seed);
    const unshieldedKeystore = createKeystore(unshieldedSeed, configuration.networkId);
    shielded = ShieldedWallet(configuration).startWithShieldedSeed(shieldedSeed);
    unshielded = UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
    dust = DustWallet(configuration).startWithSeed(dustSeed, ledger.LedgerParameters.initialParameters().dust);

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
    });
    await facade?.start(ledger.ZswapSecretKeys.fromSeed(shieldedSeed), ledger.DustSecretKey.fromSeed(dustSeed));
  });
  afterEach(async () => {
    await facade?.stop();
  });

  it('reverts transaction after it misses TTL and was not submitted yet', async () => {
    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');

    const ttl = new Date(Date.now() + 10);
    const transaction = ledger.Transaction.fromParts(
      configuration.networkId,
      undefined,
      undefined,
      ledger.Intent.new(ttl),
    );

    const finalized = await facade.finalizeTransaction(transaction); //Submission and finalization actions do save transactions

    const state = await rx.firstValueFrom(facade.state());

    await sleep(2); //Buffer for processing

    expect(spiedShieldedRevert).toHaveBeenCalled();
    expect(spiedUnshieldedRevert).toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalled();
    expect(PendingTransactions.has(state.pending, finalized, finalizedTransactionTrait)).toBe(true);
  });
});
