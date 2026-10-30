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
 * What a rejected transaction releases depends on how far the chain ran it.
 *
 * @remarks
 *   A transaction that landed as a partial success had its guaranteed segment and every fallible segment that succeeded
 *   applied, so the coins those spent are gone on chain and must not come back as available: each wallet's sync settles
 *   them. Only the coins booked in the fallible segments that failed are released. Every Dust spend sits in the
 *   guaranteed segment, because fees are paid there, so a partial success releases no Dust at all. A transaction that
 *   failed outright changed nothing on chain, so everything it booked is released like any other revert.
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
import type { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import type { SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DateTime, Option } from 'effect';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ResolvedConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';

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

/** Below the v9 fork, where a ledger-v8 transaction belongs. */
const v8Version = ProtocolVersion.ProtocolVersion(3n);

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

/** The guaranteed segment and fallible segment 1 ran; fallible segment 2 did not. */
const partialSuccess: PendingTransactions.TransactionResult = {
  status: 'PARTIAL_SUCCESS',
  segments: [
    { id: 0, success: true },
    { id: 1, success: true },
    { id: 2, success: false },
  ],
};

describe('what a rejected transaction releases', () => {
  let configuration: ResolvedConfiguration;
  let facade: WalletFacade;
  let pending: DrivenPendingTransactions;

  beforeEach(async () => {
    configuration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: { v9: ProtocolVersion.V9NativeForkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000004';
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, configuration.networkId);

    // Real, shipped wallets, deliberately never started: this suite supplies their state stream, and starting them
    // would open indexer subscriptions it has no indexer for.
    const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
    const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = await DustWallet(configuration).startWithSeed(
      getDustSeed(seed),
      ledgerV9.LedgerParameters.initialParameters().dust,
    );

    drivenBy(shielded, new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), v8Version)));
    drivenBy(unshielded, new rx.BehaviorSubject(unshieldedAt(await rx.firstValueFrom(unshielded.state), v8Version)));
    drivenBy(dust, new rx.BehaviorSubject(dustAt(await rx.firstValueFrom(dust.state), v8Version)));

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
      reservations: [],
    });
    await sleep(0.2);
  };

  const spyOnReverts = () => ({
    shielded: vi.spyOn(facade.shielded, 'revertTransaction'),
    unshielded: vi.spyOn(facade.unshielded, 'revertTransaction'),
    dust: vi.spyOn(facade.dust, 'revertTransaction'),
    shieldedSegments: vi.spyOn(facade.shielded, 'revertFailedSegments'),
    unshieldedSegments: vi.spyOn(facade.unshielded, 'revertFailedSegments'),
  });

  it('should release only the failed segments of a partially successful transaction, because the chain spent what the rest booked', async () => {
    const tx = await submitted();
    const reverts = spyOnReverts();

    await verdictArrives(tx, partialSuccess);

    expect(reverts.shieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.unshieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
    expect(pending.cleared).toContain(tx);
  });

  it('should release only the failed segments when sync has already recorded the transaction as a partial success, because the chain spent the rest either way', async () => {
    const tx = await submitted();
    const [entry] = await facade.getAllFromTxHistory();
    await configuration.txHistoryStorage.gotFinalized({
      hash: entry.hash,
      identifiers: entry.identifiers,
      status: 'PARTIAL_SUCCESS',
      protocolVersion: Number(v8Version),
      finalizedBlock: { hash: 'ledger-v8-block', height: 10, timestamp: new Date() },
    });
    const reverts = spyOnReverts();

    await verdictArrives(tx, partialSuccess);

    expect(reverts.shieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.unshieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
    expect(pending.cleared).toContain(tx);
    expect((await facade.getAllFromTxHistory()).map((recorded) => recorded.lifecycle.status)).toStrictEqual([
      'finalized',
    ]);
  });

  it('should release everything a transaction that failed outright booked, because the chain applied none of it', async () => {
    const tx = await submitted();
    const reverts = spyOnReverts();

    await verdictArrives(tx, { status: 'FAILURE', segments: [] });

    expect(reverts.shielded).toHaveBeenCalledWith(tx);
    expect(reverts.unshielded).toHaveBeenCalledWith(tx);
    expect(reverts.dust).toHaveBeenCalledWith(tx);
    expect(reverts.shieldedSegments).not.toHaveBeenCalled();
    expect(reverts.unshieldedSegments).not.toHaveBeenCalled();
    expect(pending.cleared).toContain(tx);
  });
});
