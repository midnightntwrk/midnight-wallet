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

/**
 * A transaction's record moves when a wallet's sync records it included, not only when the indexer is polled.
 *
 * @remarks
 *   Each wallet writes what its sync saw included into the history storage its factory was handed. The facade hands them
 *   one that writes through and then moves the record, so an inclusion sync saw is never lost to a poll that missed it:
 *   a record the wallet had given up on is confirmed once the chain shows it included. A partial success is left to the
 *   poller, because the history does not say which segments failed, and those decide what is released.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  type TransactionHistoryStorage,
  WalletTransaction,
  type FinalizedTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import type { SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ResolvedConfiguration,
  type WalletEntry,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../src/index.js';

import {
  createV8MockProvingService,
  DrivenLifecycle,
  drivenBy,
  dustAt,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  shieldedAt,
  sleep,
  unshieldedAt,
} from './utils/index.js';

/** Below the v9 fork, where a ledger-v8 transaction belongs. */
const v8Version = ProtocolVersion.ProtocolVersion(3n);

/** A submission service that accepts, so the pending history entry is written the way a real submission writes it. */
const acceptingSubmission: SubmissionService<FinalizedTx> = {
  // The overloaded submit signature is stated once by the service type; this fake answers the widest of its
  // overloads, which is the one the facade calls.
  submitTransaction: ((tx: FinalizedTx) =>
    Promise.resolve({
      _tag: 'Finalized' as const,
      blockHash: '00',
      blockHeight: 1n,
      tx: tx.serialize(),
      txHash: '00',
    })) as SubmissionService<FinalizedTx>['submitTransaction'],
  close: () => Promise.resolve(),
};

/** A history storage whose finalized writes fail, as a storage that cannot reach its backend does. */
const failingFinalizedWrites = (): TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry> => {
  const storage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
  return {
    getAll: () => storage.getAll(),
    get: (hash) => storage.get(hash),
    serialize: () => storage.serialize(),
    gotPending: (entry) => storage.gotPending(entry),
    gotRejected: (entry) => storage.gotRejected(entry),
    gotFinalized: () => Promise.reject(new Error('storage unavailable')),
  };
};

describe('a sync-reported inclusion', () => {
  let configuration: ResolvedConfiguration;
  let facade: WalletFacade;
  let lifecycle: DrivenLifecycle;
  /** The history storage the wallet factories were handed, which their sync writes into. */
  let walletsStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>;

  const facadeOver = async (): Promise<WalletFacade> => {
    const seed = '0000000000000000000000000000000000000000000000000000000000000004';
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, configuration.networkId);

    // Real, shipped wallets, deliberately never started: this suite supplies their state stream and writes what their
    // sync would, and starting them would open indexer subscriptions it has no indexer for.
    const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
    const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = await DustWallet(configuration).startWithSeed(
      getDustSeed(seed),
      ledgerV9.LedgerParameters.initialParameters().dust,
    );

    drivenBy(shielded, new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), v8Version)));
    drivenBy(unshielded, new rx.BehaviorSubject(unshieldedAt(await rx.firstValueFrom(unshielded.state), v8Version)));
    drivenBy(dust, new rx.BehaviorSubject(dustAt(await rx.firstValueFrom(dust.state), v8Version)));

    return WalletFacade.init({
      configuration,
      shielded: (handed) => {
        walletsStorage = handed.txHistoryStorage;
        return shielded;
      },
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
      submissionService: () => acceptingSubmission,
      transactionLifecycleService: () => lifecycle,
    });
  };

  const configurationWith = (
    txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>,
  ): ResolvedConfiguration => ({
    networkId: NetworkId.NetworkId.Undeployed,
    forks: { v9: ProtocolVersion.V9NativeForkVersion },
    relayURL: new URL('http://localhost:9944'),
    indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
    provingServerUrl: new URL('http://localhost:6300'),
    costParameters: { feeBlocksMargin: 0 },
    txHistoryStorage,
  });

  beforeEach(async () => {
    configuration = configurationWith(new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries));
    lifecycle = new DrivenLifecycle();
    facade = await facadeOver();
  });

  afterEach(async () => {
    await facade?.stop();
  });

  const submitted = async (): Promise<FinalizedTx> => {
    const finalized = await facade.finalizeTransaction(
      WalletTransaction.adopt(
        'Unproven',
        ledgerV8.Transaction.fromParts(
          configuration.networkId,
          undefined,
          undefined,
          ledgerV8.Intent.new(new Date(Date.now() + 60_000)),
        ),
        ProtocolVersion.MinSupportedVersion,
      ),
    );
    await facade.submitTransaction(finalized);
    return finalized;
  };

  /** What a wallet's sync writes for the submitted transaction once it sees it in a block with `status`. */
  const syncSees = async (status: TransactionHistoryStorage.TransactionHistoryStatus): Promise<void> => {
    const [entry] = await facade.getAllFromTxHistory();
    await walletsStorage.gotFinalized({
      hash: 'included-hash',
      identifiers: entry.identifiers,
      status,
      protocolVersion: Number(v8Version),
      finalizedBlock: { hash: 'ledger-v8-block', height: 10, timestamp: new Date() },
    });
    await sleep(0.2);
  };

  const recordStates = (): readonly string[] => lifecycle.states.value.records.map((record) => record.state._tag);

  const spyOnReverts = () => ({
    shielded: vi.spyOn(facade.shielded, 'revertTransaction'),
    unshielded: vi.spyOn(facade.unshielded, 'revertTransaction'),
    dust: vi.spyOn(facade.dust, 'revertTransaction'),
  });

  it('should confirm a submitted transaction sync saw succeed, and keep the history entry sync wrote', async () => {
    await submitted();
    const reverts = spyOnReverts();

    await syncSees('SUCCESS');

    expect(recordStates()).toStrictEqual(['Confirmed']);
    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
    expect(
      (await facade.getAllFromTxHistory()).map((recorded) => [recorded.hash, recorded.lifecycle.status]),
    ).toStrictEqual([['included-hash', 'finalized']]);
  });

  it('should confirm a transaction whose TTL the wallet saw pass, because the block that included it came first', async () => {
    await submitted();
    lifecycle.verdict({ status: 'TTL_PASSED' });
    await sleep(0.2);

    await syncSees('SUCCESS');

    expect(recordStates()).toStrictEqual(['Confirmed']);
  });

  it('should reject a submitted transaction sync saw fail, and release everything it booked once', async () => {
    const tx = await submitted();
    const reverts = spyOnReverts();

    await syncSees('FAILURE');

    expect(lifecycle.states.value.records.map((record) => record.state)).toStrictEqual([
      expect.objectContaining({ _tag: 'Rejected', verdict: { status: 'FAILURE', segments: [] } }),
    ]);
    expect(reverts.shielded.mock.calls).toStrictEqual([[tx]]);
    expect(reverts.unshielded.mock.calls).toStrictEqual([[tx]]);
    expect(reverts.dust.mock.calls).toStrictEqual([[tx]]);
    expect(lifecycle.revertedIds).toStrictEqual([]);
  });

  it('should leave a partial success sync saw to the poller, because only the indexer says which segments failed', async () => {
    await submitted();

    await syncSees('PARTIAL_SUCCESS');

    expect(recordStates()).toStrictEqual(['Submitted']);
  });

  it('should not move the record when the history write fails, so the inclusion is not recorded in one place only', async () => {
    await facade.stop();
    configuration = configurationWith(failingFinalizedWrites());
    lifecycle = new DrivenLifecycle();
    facade = await facadeOver();
    await submitted();
    const [entry] = await facade.getAllFromTxHistory();

    await expect(
      walletsStorage.gotFinalized({
        hash: 'included-hash',
        identifiers: entry.identifiers,
        status: 'SUCCESS',
        protocolVersion: Number(v8Version),
        finalizedBlock: { hash: 'ledger-v8-block', height: 10, timestamp: new Date() },
      }),
    ).rejects.toThrow('storage unavailable');
    await sleep(0.2);

    expect(recordStates()).toStrictEqual(['Submitted']);
  });
});
