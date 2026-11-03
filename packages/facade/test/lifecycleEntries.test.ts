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
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { type ResolvedConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';
import { createV8MockProvingService, getDustSeed, getShieldedSeed, getUnshieldedSeed, sleep } from './utils/index.js';
import * as rx from 'rxjs';
import { Either, Option } from 'effect';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

describe('Wallet Facade handling pending transactions', () => {
  let configuration: ResolvedConfiguration;

  let facade: WalletFacade;
  let shielded: ShieldedWallet;
  let unshielded: UnshieldedWallet;
  let dust: DustWallet;
  beforeEach(async () => {
    configuration = WalletFacade.resolveConfiguration({
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        feeBlocksMargin: 0,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    });
    const seed = '0000000000000000000000000000000000000000000000000000000000000001';
    const shieldedSeed = getShieldedSeed(seed);
    const unshieldedSeed = getUnshieldedSeed(seed);
    const dustSeed = getDustSeed(seed);
    const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, configuration.networkId);
    shielded = await ShieldedWallet(configuration).startWithSeed(shieldedSeed);
    unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
    dust = await DustWallet(configuration).startWithSeed(dustSeed, ledgerV9.LedgerParameters.initialParameters().dust);

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
    });
    await facade?.start({ shielded: shieldedSeed, unshielded: unshieldedSeed, dust: dustSeed });
  });
  afterEach(async () => {
    await facade?.stop();
  });

  it('releases only the Dust a finalized transaction booked when it misses its TTL before it is submitted, because the dust wallet holds a spend until its own grace period runs out while the other wallets sweep at that TTL', async () => {
    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');
    const endsSeen = new Set<string>();
    const watching = facade.transactionLifecycleService
      .state()
      .subscribe((lifecycle) => lifecycle.records.forEach((record) => endsSeen.add(record.state._tag)));

    const ttl = new Date(Date.now() + 10);
    const transaction = WalletTransaction.adopt(
      'Unproven',
      // The wallets here have never synced, so the facade is on the ledger-v8 side of the boundary.
      ledgerV8.Transaction.fromParts(configuration.networkId, undefined, undefined, ledgerV8.Intent.new(ttl)),
      ProtocolVersion.MinSupportedVersion,
    );

    const finalized = await facade.finalizeTransaction(transaction); //Submission and finalization actions do save transactions

    const state = await rx.firstValueFrom(facade.state());

    await sleep(2); //Buffer for processing

    watching.unsubscribe();

    expect(endsSeen).toContain('Expired');
    expect(spiedShieldedRevert).not.toHaveBeenCalled();
    expect(spiedUnshieldedRevert).not.toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalledTimes(1);
    expect(spiedDustRevert).toHaveBeenCalledWith(finalized);
    // Read off the state's own projection now, rather than through the pending set's trait machinery: what an
    // application sees is a list of transactions with a status each.
    const finalizedIds = Either.getOrThrow(
      WalletTransaction.unwrapWithin<ledgerV8.FinalizedTransaction>(
        finalized,
        ProtocolVersion.epochOf(finalized.protocolVersion, configuration.forks.v9),
      ),
    ).identifiers();
    expect(
      state.lifecycle.filter((entry) => Option.isSome(entry.transaction)).map((entry) => [...entry.identifiers].sort()),
    ).toContainEqual([...finalizedIds].sort());
  });

  it('releases only the Dust a balanced transaction booked when it misses its TTL without ever being finalized, because the dust wallet matches the booking by what the proof-erased transaction still carries', async () => {
    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');
    const endsSeen = new Set<string>();
    const watching = facade.transactionLifecycleService
      .state()
      .subscribe((lifecycle) => lifecycle.records.forEach((record) => endsSeen.add(record.state._tag)));

    const ttl = new Date(Date.now() + 10);
    const transaction = WalletTransaction.adopt(
      'Unproven',
      // The wallets here have never synced, so the facade is on the ledger-v8 side of the boundary.
      ledgerV8.Transaction.fromParts(configuration.networkId, undefined, undefined, ledgerV8.Intent.new(ttl)),
      ProtocolVersion.MinSupportedVersion,
    );

    // Balanced with nothing to add, so the record is left without any wallet having been asked for coins.
    const recipe = await facade.balanceUnprovenTransaction(transaction, { ttl, tokenKindsToBalance: [] });

    await sleep(2); //Buffer for processing

    watching.unsubscribe();

    expect(endsSeen).toContain('Balanced');
    expect(endsSeen).toContain('Expired');
    expect(spiedShieldedRevert).not.toHaveBeenCalled();
    expect(spiedUnshieldedRevert).not.toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalledTimes(1);
    const identifiersOf = (tx: Parameters<DustWallet['revertTransaction']>[0]): readonly string[] =>
      [
        ...Either.getOrThrow(
          WalletTransaction.unwrapWithin<ledgerV8.UnprovenTransaction>(
            tx,
            ProtocolVersion.epochOf(tx.protocolVersion, configuration.forks.v9),
          ),
        ).identifiers(),
      ].sort();
    expect(identifiersOf(spiedDustRevert.mock.calls[0][0])).toStrictEqual(identifiersOf(recipe.transaction));
  });
});
