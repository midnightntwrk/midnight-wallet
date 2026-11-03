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
import type { InclusionVerdict, Lifecycle } from '@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle';
import type { SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAwaiting,
  lifecycleEntriesOf,
  type ResolvedConfiguration,
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

/** The guaranteed segment and fallible segment 1 ran; fallible segment 2 did not. */
const partialSuccess: Lifecycle.RejectedVerdict = {
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
  let lifecycle: DrivenLifecycle;
  let restoredFacade: WalletFacade | undefined;

  /** A facade over fresh wallets, recording into `driven`. */
  const facadeOver = async (driven: DrivenLifecycle): Promise<WalletFacade> => {
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

    return WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
      submissionService: () => acceptingSubmission,
      transactionLifecycleService: () => driven,
    });
  };

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
    lifecycle = new DrivenLifecycle();
    facade = await facadeOver(lifecycle);
    restoredFacade = undefined;
  });

  afterEach(async () => {
    await facade?.stop();
    await restoredFacade?.stop();
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

  /** The verdict, as the lifecycle service records it once it has one. */
  const verdictArrives = async (result: Lifecycle.RejectedVerdict): Promise<void> => {
    lifecycle.verdict(result);
    await sleep(0.2);
  };

  /** Releasing the coins is not reverting the transaction: the record keeps the chain's verdict. */
  const expectStillRejected = (): void => {
    expect(lifecycle.revertedIds).toStrictEqual([]);
    expect(lifecycle.states.value.records.map((record) => record.state._tag)).toStrictEqual(['Rejected']);
  };

  const spyOnReverts = (on: WalletFacade = facade) => ({
    shielded: vi.spyOn(on.shielded, 'revertTransaction'),
    unshielded: vi.spyOn(on.unshielded, 'revertTransaction'),
    dust: vi.spyOn(on.dust, 'revertTransaction'),
    shieldedSegments: vi.spyOn(on.shielded, 'revertFailedSegments'),
    unshieldedSegments: vi.spyOn(on.unshielded, 'revertFailedSegments'),
  });

  it('should release only the failed segments of a partially successful transaction, because the chain spent what the rest booked', async () => {
    const tx = await submitted();
    const reverts = spyOnReverts();

    await verdictArrives(partialSuccess);

    expect(reverts.shieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.unshieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
    expectStillRejected();
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

    await verdictArrives(partialSuccess);

    expect(reverts.shieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.unshieldedSegments).toHaveBeenCalledWith(tx, [2]);
    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
    expectStillRejected();
    expect((await facade.getAllFromTxHistory()).map((recorded) => recorded.lifecycle.status)).toStrictEqual([
      'finalized',
    ]);
  });

  it('should release everything a transaction that failed outright booked, because the chain applied none of it', async () => {
    const tx = await submitted();
    const reverts = spyOnReverts();

    await verdictArrives({ status: 'FAILURE', segments: [] });

    expect(reverts.shielded).toHaveBeenCalledWith(tx);
    expect(reverts.unshielded).toHaveBeenCalledWith(tx);
    expect(reverts.dust).toHaveBeenCalledWith(tx);
    expect(reverts.shieldedSegments).not.toHaveBeenCalled();
    expect(reverts.unshieldedSegments).not.toHaveBeenCalled();
    expectStillRejected();
  });

  it('should release everything a transaction whose TTL passed while it waited booked, because no chain will apply any of it', async () => {
    const tx = await submitted();
    const reverts = spyOnReverts();

    await verdictArrives({ status: 'TTL_PASSED' });

    expect(reverts.shielded).toHaveBeenCalledWith(tx);
    expect(reverts.unshielded).toHaveBeenCalledWith(tx);
    expect(reverts.dust).toHaveBeenCalledWith(tx);
    expect(reverts.shieldedSegments).not.toHaveBeenCalled();
    expectStillRejected();
    expect((await facade.getAllFromTxHistory()).map((recorded) => recorded.lifecycle.status)).toStrictEqual([
      'rejected',
    ]);
  });

  it('should release everything an orphaned transaction booked and record why, leaving the record orphaned', async () => {
    const tx = await submitted();
    const reverts = spyOnReverts();

    lifecycle.orphaned(tx.protocolVersion, ProtocolVersion.V9NativeForkVersion);
    await sleep(0.2);

    expect(reverts.shielded).toHaveBeenCalledWith(tx);
    expect(reverts.unshielded).toHaveBeenCalledWith(tx);
    expect(reverts.dust).toHaveBeenCalledWith(tx);
    expect(lifecycle.revertedIds).toStrictEqual([]);
    expect(lifecycle.states.value.records.map((record) => record.state._tag)).toStrictEqual(['Orphaned']);
    const [entry] = await facade.getAllFromTxHistory();
    expect(entry.lifecycle.status === 'rejected' ? entry.lifecycle.reason : undefined).toBe(
      'orphaned-by-protocol-upgrade',
    );
  });

  it('should release a rejected transaction once, however often its record is published again, because a second release could free coins booked since', async () => {
    await submitted();
    const reverts = spyOnReverts();

    await verdictArrives({ status: 'FAILURE', segments: [] });
    lifecycle.republish();
    lifecycle.republish();
    await sleep(0.2);

    expect(reverts.shielded).toHaveBeenCalledTimes(1);
    expect(reverts.unshielded).toHaveBeenCalledTimes(1);
    expect(reverts.dust).toHaveBeenCalledTimes(1);
  });

  it('should release nothing for a confirmed transaction, because the chain spent its coins', async () => {
    await submitted();
    const reverts = spyOnReverts();

    lifecycle.verdict({ status: 'SUCCESS' });
    await sleep(0.2);

    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
    expect(reverts.shieldedSegments).not.toHaveBeenCalled();
    expect(reverts.unshieldedSegments).not.toHaveBeenCalled();
  });

  /**
   * A transaction finalized here and handed to someone else to submit, as a swap is: the record never passes through
   * submitted, yet the chain can still include it and refuse it.
   */
  const finalizedForAnotherToSubmit = (): Promise<FinalizedTx> =>
    facade.finalizeTransaction(
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

  /** The chain's verdict, as an inclusion the lifecycle service was told of by identifiers. */
  const chainIncludes = async (verdict: InclusionVerdict): Promise<void> => {
    const [record] = lifecycle.states.value.records;
    await lifecycle.included(record.identifiers, verdict);
    await sleep(0.2);
  };

  it('should reject a finalized transaction someone else submitted that the chain refused, and release everything it booked, because the chain applied none of it', async () => {
    const tx = await finalizedForAnotherToSubmit();
    expect(lifecycle.states.value.records.map((record) => record.state._tag)).toStrictEqual(['Finalized']);
    const reverts = spyOnReverts();

    await chainIncludes({ status: 'FAILURE', segments: [] });

    expectStillRejected();
    expect(reverts.shielded.mock.calls).toStrictEqual([[tx]]);
    expect(reverts.unshielded.mock.calls).toStrictEqual([[tx]]);
    expect(reverts.dust.mock.calls).toStrictEqual([[tx]]);
    expect(reverts.shieldedSegments).not.toHaveBeenCalled();
    expect(reverts.unshieldedSegments).not.toHaveBeenCalled();
  });

  it('should release only the failed segments of a finalized transaction someone else submitted that landed as a partial success, because the chain spent what the rest booked', async () => {
    const tx = await finalizedForAnotherToSubmit();
    expect(lifecycle.states.value.records.map((record) => record.state._tag)).toStrictEqual(['Finalized']);
    const reverts = spyOnReverts();

    await chainIncludes(partialSuccess);

    // Ended, whichever status a partial success shows as: the chain has answered.
    expect(lifecycleEntriesOf(lifecycle.states.value).filter(isAwaiting)).toStrictEqual([]);
    expect(reverts.shieldedSegments.mock.calls).toStrictEqual([[tx, [2]]]);
    expect(reverts.unshieldedSegments.mock.calls).toStrictEqual([[tx, [2]]]);
    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
  });

  it('should release nothing for a record that was already rejected when the facade started, because the session that saw the verdict released its coins', async () => {
    await submitted();
    await facade.stop();
    lifecycle.verdict({ status: 'FAILURE', segments: [] });
    const restored = new DrivenLifecycle(lifecycle.states.value);
    restoredFacade = await facadeOver(restored);
    const reverts = spyOnReverts(restoredFacade);

    restored.republish();
    await sleep(0.2);

    expect(reverts.shielded).not.toHaveBeenCalled();
    expect(reverts.unshielded).not.toHaveBeenCalled();
    expect(reverts.dust).not.toHaveBeenCalled();
    expect(reverts.shieldedSegments).not.toHaveBeenCalled();
    expect(reverts.unshieldedSegments).not.toHaveBeenCalled();
  });
});
