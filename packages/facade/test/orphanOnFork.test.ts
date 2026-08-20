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

import * as ledger from '@midnightntwrk/ledger-v9';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import type { PendingTransactionsService } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet, V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DateTime, Option } from 'effect';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DefaultConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';
import { finalizedTransactionTrait } from '../src/transaction.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, sleep } from './utils/index.js';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

type Recorded = Readonly<{
  added: { tx: ledger.FinalizedTransaction; protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion> }[];
  cleared: ledger.FinalizedTransaction[];
  orphanedBeyond: ProtocolVersion.ProtocolVersion[];
}>;

/**
 * A pending-transactions service the test drives directly: it records what the facade asks of it, and lets the test
 * push a pending state so the facade's reaction to an orphaned entry is observable without a real fork.
 */
class RecordingPendingTransactions implements PendingTransactionsService<ledger.FinalizedTransaction> {
  readonly recorded: Recorded = { added: [], cleared: [], orphanedBeyond: [] };
  readonly states = new rx.BehaviorSubject<PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>>(
    PendingTransactions.empty(),
  );

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  state(): rx.Observable<PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>> {
    return this.states.asObservable();
  }

  addPendingTransaction(
    tx: ledger.FinalizedTransaction,
    protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
  ): Promise<void> {
    this.recorded.added.push({ tx, protocolVersion });
    return Promise.resolve();
  }

  clear(tx: ledger.FinalizedTransaction): Promise<void> {
    this.recorded.cleared.push(tx);
    return Promise.resolve();
  }

  orphanBeyond(chainNow: ProtocolVersion.ProtocolVersion): Promise<void> {
    this.recorded.orphanedBeyond.push(chainNow);
    return Promise.resolve();
  }
}

describe('A pending transaction the fork left behind', () => {
  let configuration: DefaultConfiguration;
  let facade: WalletFacade;
  let shielded: ShieldedWallet;
  let unshielded: UnshieldedWallet;
  let dust: DustWallet;
  let pending: RecordingPendingTransactions;

  beforeEach(async () => {
    configuration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forkVersion: V9_NATIVE_FORK_VERSION,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000001';
    const shieldedSeed = getShieldedSeed(seed);
    const unshieldedSeed = getUnshieldedSeed(seed);
    const dustSeed = getDustSeed(seed);
    const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, configuration.networkId);
    shielded = ShieldedWallet(configuration).startWithSeed(shieldedSeed);
    unshielded = UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
    dust = DustWallet(configuration).startWithSeed(dustSeed, ledger.LedgerParameters.initialParameters().dust);
    pending = new RecordingPendingTransactions();

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      pendingTransactionsService: () => pending,
    });
    // The wallets are not started: these tests observe the state the facade already has, and starting them
    // would open indexer subscriptions this suite has no indexer for.
  });

  afterEach(async () => {
    await facade?.stop();
  });

  const anyTransaction = (): ledger.UnprovenTransaction =>
    ledger.Transaction.fromParts(
      configuration.networkId,
      undefined,
      undefined,
      ledger.Intent.new(new Date(Date.now() + 60_000)),
    );

  it('asks the pending set to give up on everything the wallets have moved past', async () => {
    await sleep(0.2);

    const observed = await rx.firstValueFrom(facade.state());

    expect(pending.recorded.orphanedBeyond).toContainEqual(observed.activeProtocolVersion);
  });

  it('stamps a newly pending transaction with the protocol version the wallets have reached', async () => {
    const observed = await rx.firstValueFrom(facade.state());

    const finalized = await facade.finalizeTransaction(anyTransaction());

    const entry = pending.recorded.added.find((added) => added.tx === finalized);
    expect(entry).toBeDefined();
    expect(entry?.protocolVersion).toStrictEqual(Option.some(observed.activeProtocolVersion));
  });

  it('reverts an orphaned transaction and records why it will never be included', async () => {
    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');

    const finalized = await facade.finalizeTransaction(anyTransaction());

    pending.states.next({
      all: [
        {
          tx: finalized,
          creationTime: DateTime.unsafeMake(Date.now()),
          protocolVersion: Option.some(ProtocolVersion.MinSupportedVersion),
          result: {
            status: 'ORPHANED_BY_FORK',
            authoredFor: ProtocolVersion.MinSupportedVersion,
            chainNow: V9_NATIVE_FORK_VERSION,
          },
        },
      ],
    });

    await sleep(0.2);

    expect(spiedShieldedRevert).toHaveBeenCalled();
    expect(spiedUnshieldedRevert).toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalled();
    expect(pending.recorded.cleared).toContain(finalized);

    const entries = await facade.getAllFromTxHistory();
    const rejected = entries.filter((entry) => entry.lifecycle.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].lifecycle.status === 'rejected' ? rejected[0].lifecycle.reason : undefined).toBe(
      'orphaned-by-protocol-upgrade',
    );
    expect(rejected[0].identifiers).toStrictEqual(finalizedTransactionTrait.ids(finalized));
  });
});
