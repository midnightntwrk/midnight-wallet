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

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  SerializedTransaction,
  WalletTransaction,
  type FinalizedTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { SubmissionEvent, type SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { Option } from 'effect';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ResolvedConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';
import { finalizedTransactionTraits } from '../src/transaction.js';

import {
  createV8MockProvingService,
  DrivenLifecycle,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  SilentPendingTransactions,
  sleep,
} from './utils/index.js';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

describe('A pending transaction the fork left behind', () => {
  let configuration: ResolvedConfiguration;
  let facade: WalletFacade;
  let shielded: ShieldedWallet;
  let unshielded: UnshieldedWallet;
  let dust: DustWallet;
  let lifecycle: DrivenLifecycle;

  beforeEach(async () => {
    configuration = WalletFacade.resolveConfiguration({
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
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
    lifecycle = new DrivenLifecycle();

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
      pendingTransactionsService: () => new SilentPendingTransactions(),
      transactionLifecycleService: () => lifecycle,
      // There is no node here: a submission that is accepted at once lets a test observe what the facade books.
      submissionService: () => ({
        // Type cast required because: the overloaded submit signature is stated once by the service type; this fake
        // answers the status the facade waits for, which is the only one it ever asks for.
        submitTransaction: ((): Promise<SubmissionEvent> =>
          Promise.resolve(
            SubmissionEvent.Finalized({
              tx: SerializedTransaction.of(new Uint8Array()),
              txHash: '',
              blockHash: '',
              blockHeight: 0n,
            }),
          )) as SubmissionService<FinalizedTx>['submitTransaction'],
        close: () => Promise.resolve(),
      }),
    });
    // The wallets are not started: these tests observe the state the facade already has, and starting them
    // would open indexer subscriptions this suite has no indexer for.
  });

  afterEach(async () => {
    await facade?.stop();
  });

  const anyTransaction = () =>
    WalletTransaction.adopt(
      'Unproven',
      // The wallets here have never synced, so the facade is on the ledger-v8 side of the boundary and the ledger
      // version that owns that epoch is the one that has to have built this.
      ledgerV8.Transaction.fromParts(
        configuration.networkId,
        undefined,
        undefined,
        ledgerV8.Intent.new(new Date(Date.now() + 60_000)),
      ),
      ProtocolVersion.MinSupportedVersion,
    );

  it('reports the boundary the wallets are on, and agrees with the version it acts at', async () => {
    // The reading `activeProtocolVersion` alone cannot give: three versions that differ say nothing about whether the
    // difference spans the boundary. Here the wallets have never synchronized, so they are all in the epoch a wallet
    // with no history belongs to — which is a settled chain, at the version the facade is bound to.
    const observed = await rx.firstValueFrom(facade.state());

    expect(observed.protocol).toStrictEqual({ _tag: 'Settled', version: observed.activeProtocolVersion });
  });

  it('asks the lifecycle records to give up on everything the wallets have moved past', async () => {
    await sleep(0.2);

    const observed = await rx.firstValueFrom(facade.state());

    expect(lifecycle.orphanedBeyond).toContainEqual(observed.activeProtocolVersion);
  });

  it('stamps a newly pending transaction with the protocol version the wallets have reached', async () => {
    const observed = await rx.firstValueFrom(facade.state());

    await facade.finalizeTransaction(anyTransaction());

    const [record] = lifecycle.states.value.records;
    expect(record.protocolVersion).toStrictEqual(Option.some(observed.activeProtocolVersion));
  });

  it('stamps a submitted transaction with the version its own bytes were built for, not the one the wallets report', async () => {
    const observed = await rx.firstValueFrom(facade.state());
    // Inside the wallets' epoch, so the facade accepts it, yet not the version they report.
    const builtFor = ProtocolVersion.ProtocolVersion(observed.activeProtocolVersion + 1n);
    const submitted: FinalizedTx = WalletTransaction.adopt(
      'Finalized',
      ledgerV8.Transaction.fromParts(configuration.networkId),
      builtFor,
    );

    await facade.submitTransaction(submitted);

    const [record] = lifecycle.states.value.records;
    expect(record.protocolVersion).toStrictEqual(Option.some(builtFor));
  });

  it('reverts an orphaned transaction and records why it will never be included', async () => {
    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');

    const finalized = await facade.finalizeTransaction(anyTransaction());

    lifecycle.orphaned(ProtocolVersion.MinSupportedVersion, ProtocolVersion.V9NativeForkVersion);

    await sleep(0.2);

    expect(spiedShieldedRevert).toHaveBeenCalled();
    expect(spiedUnshieldedRevert).toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalled();
    expect(lifecycle.revertedIds).toStrictEqual([]);
    expect(lifecycle.states.value.records.map((record) => record.state._tag)).toStrictEqual(['Orphaned']);

    const entries = await facade.getAllFromTxHistory();
    const rejected = entries.filter((entry) => entry.lifecycle.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].lifecycle.status === 'rejected' ? rejected[0].lifecycle.reason : undefined).toBe(
      'orphaned-by-protocol-upgrade',
    );
    expect(rejected[0].identifiers).toStrictEqual(
      Option.getOrThrow(
        ProtocolVersion.select(finalizedTransactionTraits(configuration.forks.v9), finalized.protocolVersion),
      ).ids(finalized),
    );
  });
});
