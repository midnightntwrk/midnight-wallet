/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
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
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { type DefaultConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';
import {
  createPreForkMockProvingService,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  sleep,
} from './utils/index.js';
import * as rx from 'rxjs';

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
      forks: { v9: ProtocolVersion.V9NativeForkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        feeBlocksMargin: 0,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000001';
    const shieldedSeed = getShieldedSeed(seed);
    const unshieldedSeed = getUnshieldedSeed(seed);
    const dustSeed = getDustSeed(seed);
    const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, configuration.networkId);
    shielded = await ShieldedWallet(configuration).startWithSeed(shieldedSeed);
    unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
    dust = await DustWallet(configuration).startWithSeed(dustSeed, ledger.LedgerParameters.initialParameters().dust);

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createPreForkMockProvingService(),
    });
    await facade?.start({ shielded: shieldedSeed, unshielded: unshieldedSeed, dust: dustSeed });
  });
  afterEach(async () => {
    await facade?.stop();
  });

  it('reverts transaction after it misses TTL and was not submitted yet', async () => {
    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');

    const ttl = new Date(Date.now() + 10);
    const transaction = WalletTransaction.adopt(
      'Unproven',
      // The wallets here have never synced, so the facade is on the pre-fork side of the boundary.
      preForkLedger.Transaction.fromParts(configuration.networkId, undefined, undefined, preForkLedger.Intent.new(ttl)),
      ProtocolVersion.MinSupportedVersion,
    );

    const finalized = await facade.finalizeTransaction(transaction); //Submission and finalization actions do save transactions

    const state = await rx.firstValueFrom(facade.state());

    await sleep(2); //Buffer for processing

    expect(spiedShieldedRevert).toHaveBeenCalled();
    expect(spiedUnshieldedRevert).toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalled();
    // Read off the state's own projection now, rather than through the pending set's trait machinery: what an
    // application sees is a list of transactions with a status each.
    expect(state.pending.map((entry) => entry.transaction)).toContain(finalized);
  });
});
