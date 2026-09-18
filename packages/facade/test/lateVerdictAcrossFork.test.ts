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

/**
 * A verdict that arrives for a transaction of the epoch the wallets have already left.
 *
 * @remarks
 *   `orphanOnFork.test.ts` covers the near half of this: a pending transaction the fork strands, seen by a facade that
 *   has not itself crossed. This is the far half, and the one a real crossing produces. A transaction submitted before
 *   the boundary is recorded as pending by the same session that submitted it; the chain then forks, and only
 *   afterwards does the verdict on that transaction arrive — a rejection the indexer reports, a TTL the poller
 *   synthesizes, or the wallet's own orphaning. By then the facade acts at the version past the boundary, and the
 *   transaction it is being asked about belongs to the other side of it.
 *
 *   The entry is this session's own, so there is something to land on, and it is the only record the application has of a
 *   transaction that will never be included. Leaving it at `pending` forever is the failure this pins.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  WalletTransaction,
  type FinalizedTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import type { SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { DustWallet, type DustWalletState } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet, type ShieldedWalletState } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedWalletState,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DateTime, Option } from 'effect';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizedTransactionTraits } from '../src/transaction.js';
import {
  type ResolvedConfiguration,
  WalletEntrySchema,
  WalletFacade,
  isPendingWalletEntry,
  mergeWalletEntries,
} from '../src/index.js';

import {
  createV8MockProvingService,
  drivenBy,
  dustAt,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  shieldedAt,
  SilentPendingTransactions,
  sleep,
  unshieldedAt,
} from './utils/index.js';

/** The boundary this chain forks at. */
const forkVersion = ProtocolVersion.V9NativeForkVersion;

/** Where the three wallets are before it: one epoch, ordinary drift within it. */
const v8Version = ProtocolVersion.ProtocolVersion(3n);

/** Where they are after: past the boundary, which is where a wallet that has crossed reports from. */
const v9Version = ProtocolVersion.ProtocolVersion(forkVersion + 1n);

/** A pending service the suite drives: the facade's reaction to a verdict is what is under test, not the polling. */
class DrivenPendingTransactions extends SilentPendingTransactions {
  readonly cleared: FinalizedTx[] = [];

  override clear(tx: FinalizedTx): Promise<void> {
    this.cleared.push(tx);
    return Promise.resolve();
  }
}

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

describe('a verdict that arrives after the wallets have crossed the boundary', () => {
  let configuration: ResolvedConfiguration;
  let facade: WalletFacade;
  let pending: DrivenPendingTransactions;
  let shieldedStates: rx.BehaviorSubject<ShieldedWalletState>;
  let unshieldedStates: rx.BehaviorSubject<UnshieldedWalletState>;
  let dustStates: rx.BehaviorSubject<DustWalletState>;

  beforeEach(async () => {
    configuration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: { v9: forkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000003';
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, configuration.networkId);

    // Real, shipped wallets, deliberately never started: this suite supplies their state stream, and starting them
    // would open indexer subscriptions it has no indexer for.
    const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
    const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = await DustWallet(configuration).startWithSeed(
      getDustSeed(seed),
      ledgerV9.LedgerParameters.initialParameters().dust,
    );

    shieldedStates = new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), v8Version));
    unshieldedStates = new rx.BehaviorSubject(unshieldedAt(await rx.firstValueFrom(unshielded.state), v8Version));
    dustStates = new rx.BehaviorSubject(dustAt(await rx.firstValueFrom(dust.state), v8Version));

    drivenBy(shielded, shieldedStates);
    drivenBy(unshielded, unshieldedStates);
    drivenBy(dust, dustStates);

    pending = new DrivenPendingTransactions();

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
      submissionService: () => acceptingSubmission,
      pendingTransactionsService: () => pending,
    });
  });

  afterEach(async () => {
    await facade?.stop();
  });

  /** A transaction of the epoch the wallets are in while they are still below the boundary. */
  const v8Transaction = () =>
    WalletTransaction.adopt(
      'Unproven',
      ledgerV8.Transaction.fromParts(
        configuration.networkId,
        undefined,
        undefined,
        ledgerV8.Intent.new(new Date(Date.now() + 60_000)),
      ),
      ProtocolVersion.MinSupportedVersion,
    );

  /** Submits a transaction below the boundary, then moves all three wallets past it. */
  const submitThenCross = async (): Promise<FinalizedTx> => {
    const finalized = await facade.finalizeTransaction(v8Transaction());
    await facade.submitTransaction(finalized);

    shieldedStates.next(shieldedAt(shieldedStates.value, v9Version));
    unshieldedStates.next(unshieldedAt(unshieldedStates.value, v9Version));
    dustStates.next(dustAt(dustStates.value, v9Version));
    await sleep(0.2);

    return finalized;
  };

  /** The verdict, as the pending set reports it once it has one. */
  const verdictArrives = async (tx: FinalizedTx, result: PendingTransactions.TransactionResult): Promise<void> => {
    pending.states.next({
      all: [
        {
          tx,
          creationTime: DateTime.unsafeMake(Date.now()),
          protocolVersion: Option.some(ProtocolVersion.MinSupportedVersion),
          result,
        },
      ],
    });
    await sleep(0.2);
  };

  it('leaves the wallets past the boundary, so the transaction is of the epoch they have left', async () => {
    const finalized = await submitThenCross();

    const observed = await rx.firstValueFrom(facade.state());

    expect(observed.activeProtocolVersion).toBe(v9Version);
    expect(finalized.protocolVersion).toBeLessThan(forkVersion);
  });

  it('records the rejection a chain reported after the crossing, on the entry the submission wrote', async () => {
    const finalized = await submitThenCross();
    expect(await facade.getAllFromTxHistory()).toHaveLength(1);

    await verdictArrives(finalized, { status: 'FAILURE', segments: [] });

    const entries = await facade.getAllFromTxHistory();
    expect(entries.filter(isPendingWalletEntry)).toStrictEqual([]);
    expect(entries.map((entry) => entry.lifecycle.status)).toStrictEqual(['rejected']);
  });

  it('records why a transaction the fork orphaned will never be included, once the wallets have crossed', async () => {
    const finalized = await submitThenCross();

    await verdictArrives(finalized, {
      status: 'ORPHANED_BY_FORK',
      authoredFor: ProtocolVersion.MinSupportedVersion,
      chainNow: v9Version,
    });

    const entries = await facade.getAllFromTxHistory();
    const [entry] = entries;
    expect(entries).toHaveLength(1);
    expect(entry.lifecycle.status === 'rejected' ? entry.lifecycle.reason : undefined).toBe(
      'orphaned-by-protocol-upgrade',
    );
  });

  it('still gives up on the transaction in the pending set, whichever epoch it belongs to', async () => {
    const finalized = await submitThenCross();

    await verdictArrives(finalized, { status: 'FAILURE', segments: [] });

    expect(pending.cleared).toContain(finalized);
  });

  it.each(['orphan', 'TTL', 'partial success'] as const)(
    'preserves on-chain history when a late %s verdict arrives under the submission hash',
    async (verdict) => {
      const tx = await submitThenCross();
      const [submitted] = await facade.getAllFromTxHistory();
      // Aggregation can give the included transaction a different hash and additional identifiers.
      await configuration.txHistoryStorage.gotFinalized({
        hash: 'aggregated-chain-hash',
        identifiers: [...submitted.identifiers, 'another-intent'],
        status: verdict === 'partial success' ? 'PARTIAL_SUCCESS' : 'SUCCESS',
        protocolVersion: Number(v8Version),
        finalizedBlock: { hash: 'ledger-v8-block', height: 10, timestamp: new Date() },
      });
      const revert = vi.spyOn(facade.shielded, 'revertTransaction');
      await verdictArrives(
        tx,
        verdict === 'orphan'
          ? { status: 'ORPHANED_BY_FORK', authoredFor: tx.protocolVersion, chainNow: v9Version }
          : { status: verdict === 'TTL' ? 'FAILURE' : 'PARTIAL_SUCCESS', segments: [] },
      );

      const entries = await facade.getAllFromTxHistory();
      expect(entries).toHaveLength(1);
      expect(entries[0].hash).toBe('aggregated-chain-hash');
      expect(entries[0].lifecycle.status).toBe('finalized');
      expect(pending.cleared).toContain(tx);
      if (verdict === 'partial success') expect(revert).toHaveBeenCalledWith(tx);
      else expect(revert).not.toHaveBeenCalled();
    },
  );

  it('clears a pending transaction the fork orphaned once its inclusion is known, recording no rejection', async () => {
    const tx = await facade.finalizeTransaction(v8Transaction());
    await facade.submitTransaction(tx);
    const [submitted] = await facade.getAllFromTxHistory();
    await configuration.txHistoryStorage.gotFinalized({
      hash: submitted.hash,
      identifiers: submitted.identifiers,
      status: 'SUCCESS',
      finalizedBlock: { hash: 'ledger-v8-block', height: 10, timestamp: new Date() },
    });
    const traits = finalizedTransactionTraits(forkVersion);
    pending.states.next({
      all: [{ tx, creationTime: DateTime.unsafeMake(Date.now()), protocolVersion: Option.some(tx.protocolVersion) }],
    });
    vi.spyOn(pending, 'clear').mockImplementation((transaction) => {
      pending.states.next(PendingTransactions.clear(pending.states.value, transaction, traits));
      return Promise.resolve();
    });
    const orphan = vi.spyOn(pending, 'orphanBeyond').mockImplementation((version) => {
      pending.states.next(PendingTransactions.orphanBeyond(pending.states.value, traits, version));
      return Promise.resolve();
    });

    shieldedStates.next(shieldedAt(shieldedStates.value, v9Version));
    unshieldedStates.next(unshieldedAt(unshieldedStates.value, v9Version));
    dustStates.next(dustAt(dustStates.value, v9Version));

    await vi.waitFor(() => expect(orphan).toHaveBeenCalledWith(v9Version));
    await vi.waitFor(() => expect(pending.states.value.all).toHaveLength(0));
    expect((await facade.getAllFromTxHistory()).map((entry) => entry.lifecycle.status)).toEqual(['finalized']);
  });

  it('keeps orphaning at each version the wallets reach when the history storage cannot be read', async () => {
    const tx = await facade.finalizeTransaction(v8Transaction());
    await facade.submitTransaction(tx);
    pending.states.next({
      all: [{ tx, creationTime: DateTime.unsafeMake(Date.now()), protocolVersion: Option.some(tx.protocolVersion) }],
    });
    vi.spyOn(configuration.txHistoryStorage, 'getAll').mockRejectedValue(new Error('history storage unavailable'));
    const orphan = vi.spyOn(pending, 'orphanBeyond');

    shieldedStates.next(shieldedAt(shieldedStates.value, v9Version));
    unshieldedStates.next(unshieldedAt(unshieldedStates.value, v9Version));
    dustStates.next(dustAt(dustStates.value, v9Version));
    await vi.waitFor(() => expect(orphan).toHaveBeenCalledWith(v9Version));

    const later = ProtocolVersion.ProtocolVersion(v9Version + 1n);
    shieldedStates.next(shieldedAt(shieldedStates.value, later));
    unshieldedStates.next(unshieldedAt(unshieldedStates.value, later));
    dustStates.next(dustAt(dustStates.value, later));
    await vi.waitFor(() => expect(orphan).toHaveBeenCalledWith(later));
  });
});
