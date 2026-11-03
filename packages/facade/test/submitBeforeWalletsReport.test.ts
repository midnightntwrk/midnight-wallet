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
 * A transaction submitted before the facade has heard from all three wallets.
 *
 * @remarks
 *   The facade learns the chain's version only once every wallet has reported one, and an application can submit before
 *   then: a transaction it built earlier and kept, or one adopted from bytes. The pending set gives up on a transaction
 *   at the fork only by the version it is booked with, so a transaction booked without one would wait out its TTL for
 *   an inclusion no chain past the boundary can make.
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
import type { SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { DustWallet, type DustWalletState } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DateTime, type Option } from 'effect';
import * as rx from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ResolvedConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';
import { finalizedTransactionTraits } from '../src/transaction.js';
import {
  createV8MockProvingService,
  drivenBy,
  dustAt,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  shieldedAt,
  SilentPendingTransactions,
  unshieldedAt,
} from './utils/index.js';

/** The boundary this chain forks at. */
const forkVersion = ProtocolVersion.V9NativeForkVersion;

/** Where the wallets that have reported are, below the boundary. */
const v8Version = ProtocolVersion.ProtocolVersion(3n);

/** Where all three are once they have crossed it. */
const v9Version = ProtocolVersion.ProtocolVersion(forkVersion + 1n);

/** A pending set that keeps its state with the shipped pure transforms, so what it books decides what it orphans. */
class PureStatePendingTransactions extends SilentPendingTransactions {
  readonly #traits = finalizedTransactionTraits(forkVersion);

  override addPendingTransaction(
    tx: FinalizedTx,
    protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
  ): Promise<void> {
    this.states.next(
      PendingTransactions.addPendingTransaction(
        this.states.value,
        tx,
        DateTime.unsafeMake(Date.now()),
        this.#traits,
        protocolVersion,
      ),
    );
    return Promise.resolve();
  }

  override clear(tx: FinalizedTx): Promise<void> {
    this.states.next(PendingTransactions.clear(this.states.value, tx, this.#traits));
    return Promise.resolve();
  }

  override orphanBeyond(chainNow: ProtocolVersion.ProtocolVersion): Promise<void> {
    this.states.next(PendingTransactions.orphanBeyond(this.states.value, this.#traits, chainNow));
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

describe('a transaction submitted before every wallet has reported a version', () => {
  let facade: WalletFacade | undefined;

  afterEach(async () => {
    await facade?.stop();
  });

  it('is still given up on at the fork, because it is booked with the version its own bytes were built for', async () => {
    const configuration: ResolvedConfiguration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: { v9: forkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000004';
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, configuration.networkId);

    // Real, shipped wallets, deliberately never started: this suite supplies their state streams, and starting them
    // would open indexer subscriptions it has no indexer for.
    const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
    const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = await DustWallet(configuration).startWithSeed(
      getDustSeed(seed),
      ledgerV9.LedgerParameters.initialParameters().dust,
    );

    const shieldedStates = new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), v8Version));
    const unshieldedStates = new rx.BehaviorSubject(unshieldedAt(await rx.firstValueFrom(unshielded.state), v8Version));
    const dustState = await rx.firstValueFrom(dust.state);
    // The dust wallet has not reported yet, so the facade has observed no version at all.
    const dustStates = new rx.ReplaySubject<DustWalletState>(1);

    drivenBy(shielded, shieldedStates);
    drivenBy(unshielded, unshieldedStates);
    drivenBy(dust, dustStates);

    const pending = new PureStatePendingTransactions();
    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
      submissionService: () => acceptingSubmission,
      pendingTransactionsService: () => pending,
    });

    const submitted: FinalizedTx = WalletTransaction.adopt(
      'Finalized',
      ledgerV8.Transaction.fromParts(
        configuration.networkId,
        undefined,
        undefined,
        ledgerV8.Intent.new(new Date(Date.now() + 60_000)),
      ),
      v8Version,
    );
    await facade.submitTransaction(submitted);

    shieldedStates.next(shieldedAt(shieldedStates.value, v9Version));
    unshieldedStates.next(unshieldedAt(unshieldedStates.value, v9Version));
    dustStates.next(dustAt(dustState, v9Version));

    const history = facade;
    await vi.waitFor(async () => {
      const entries = await history.getAllFromTxHistory();
      expect(entries).toHaveLength(1);
      expect(entries[0].lifecycle.status === 'rejected' ? entries[0].lifecycle.reason : undefined).toBe(
        'orphaned-by-protocol-upgrade',
      );
    });
  });
});
