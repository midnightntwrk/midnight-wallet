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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { type SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  type DefaultConfiguration,
  WalletEntrySchema,
  WalletFacade,
  isPendingWalletEntry,
  mergeWalletEntries,
} from '../src/index.js';

describe('Facade submission', () => {
  it('is gracefully closed when wallet is stopped', async () => {
    const seed = crypto.randomBytes(32);
    const fakeSubmission = new (class implements SubmissionService<ledger.FinalizedTransaction> {
      #gotClosed = false;

      get gotClosed() {
        return this.#gotClosed;
      }

      submitTransaction = () => Promise.reject(new Error('This submission implementation does not submit'));
      close = () => {
        return new Promise<void>((resolve) => {
          this.#gotClosed = true;
          resolve();
        });
      };
    })();
    const configuration: DefaultConfiguration = {
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
    };

    const facade: WalletFacade = await WalletFacade.init({
      configuration,
      submissionService: () => fakeSubmission,
      shielded: (config) => {
        const mockedShielded = vi.mockObject(ShieldedWallet(config).startWithSeed(seed));
        mockedShielded.start.mockResolvedValue(undefined);
        return mockedShielded;
      },
      unshielded: (config) => {
        const mockedUnshielded = vi.mockObject(
          UnshieldedWallet(config).startWithPublicKey(
            PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret: seed }, config.networkId)),
          ),
        );
        mockedUnshielded.start.mockResolvedValue(undefined);
        return mockedUnshielded;
      },
      dust: (config) => {
        const mockedDust = vi.mockObject(
          DustWallet(config).startWithSeed(seed, ledger.LedgerParameters.initialParameters().dust),
        );
        mockedDust.start.mockResolvedValue(undefined);
        return mockedDust;
      },
    });

    await facade.start(ledger.ZswapSecretKeys.fromSeed(seed), ledger.DustSecretKey.fromSeed(seed));
    await facade.stop();

    expect(fakeSubmission.gotClosed).toBe(true);
  });

  it('reverts transaction, which failed submission', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    const config = {
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        feeBlocksMargin: 0,
      },
      txHistoryStorage,
    };
    const seed = crypto.randomBytes(32);
    const shielded = ShieldedWallet(config).startWithSeed(seed);
    const unshielded = UnshieldedWallet(config).startWithPublicKey(
      PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret: seed }, config.networkId)),
    );
    const dust = DustWallet(config).startWithSeed(seed, ledger.LedgerParameters.initialParameters().dust);
    const fakeSubmission = new (class implements SubmissionService<ledger.FinalizedTransaction> {
      submitTransaction = () => Promise.reject(new Error('Submission failed'));
      close = () => Promise.resolve();
    })();

    const facade: WalletFacade = await WalletFacade.init({
      configuration: config,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      submissionService: () => fakeSubmission,
    });

    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');

    const transaction = ledger.Transaction.fromParts(
      config.networkId,
      undefined,
      undefined,
      ledger.Intent.new(new Date(Date.now() + 1000)),
    )
      .mockProve()
      .bind();

    const submissionResult = await facade.submitTransaction(transaction).then(
      () => 'succeeded',
      () => 'failed',
    );

    expect(spiedShieldedRevert).toHaveBeenCalled();
    expect(spiedUnshieldedRevert).toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalled();
    expect(submissionResult).toBe('failed');

    // The pending entry written at submit time and the rejected entry written on revert share one key (both go through
    // `txHistoryHash`), so the failed submission leaves a single entry transitioned in place — not an orphan pair.
    const entries = await txHistoryStorage.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe(transaction.transactionHash().toString());
    expect(entries[0].lifecycle.status).toBe('rejected');
  });

  it('pairs submit and revert for a non-hashable (proof-erased) tx, transitioning the entry in place', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    const config = {
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        feeBlocksMargin: 0,
      },
      txHistoryStorage,
    };
    const seed = crypto.randomBytes(32);
    const shielded = ShieldedWallet(config).startWithSeed(seed);
    const unshielded = UnshieldedWallet(config).startWithPublicKey(
      PublicKey.fromKeyStore(createKeystore(seed, config.networkId)),
    );
    const dust = DustWallet(config).startWithSeed(seed, ledger.LedgerParameters.initialParameters().dust);
    const fakeSubmission = new (class implements SubmissionService<ledger.FinalizedTransaction> {
      submitTransaction = () => Promise.reject(new Error('Submission failed'));
      close = () => Promise.resolve();
    })();

    const facade: WalletFacade = await WalletFacade.init({
      configuration: config,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      submissionService: () => fakeSubmission,
    });

    // The simulator submits proof-erased transactions, whose `transactionHash()` throws — so the key falls back to the
    // serialized bytes. The runtime tx type is erased exactly as the simulator submission service does (helpers.ts),
    // which the static `FinalizedTransaction` type can't express.
    const proofErased = ledger.Transaction.fromParts(
      config.networkId,
      undefined,
      undefined,
      ledger.Intent.new(new Date(Date.now() + 10_000)),
    ).eraseProofs();
    expect(() => proofErased.transactionHash()).toThrow();
    const transaction = proofErased as unknown as ledger.FinalizedTransaction;

    // Submission fails, so submitTransaction writes the pending entry and then reverts — both keyed off the same
    // serialized-bytes hash, so the result is a single entry transitioned in place rather than an orphan pending +
    // orphan rejected pair.
    const submissionResult = await facade.submitTransaction(transaction).then(
      () => 'succeeded',
      () => 'failed',
    );
    expect(submissionResult).toBe('failed');

    const entries = await txHistoryStorage.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe(Buffer.from(proofErased.serialize()).toString('hex'));
    expect(entries[0].lifecycle.status).toBe('rejected');
  });
});

describe('Facade transaction history reads return entries regardless of lifecycle', () => {
  // Regression: queryTxHistoryByHash / getAllFromTxHistory once filtered to finalized entries, hiding pending ones
  // (commits e40e65de, d19f99e0). A submitted-but-not-yet-confirmed tx must be retrievable as pending — the docker
  // e2e tests all wait until finalized, so they would not catch reintroduction of a finalized-only filter.
  it('returns a pending entry via queryTxHistoryByHash and getAllFromTxHistory', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    const config = {
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage,
    };
    const seed = crypto.randomBytes(32);
    const fakeSubmission = new (class implements SubmissionService<ledger.FinalizedTransaction> {
      submitTransaction = () => Promise.reject(new Error('not used in this test'));
      close = () => Promise.resolve();
    })();
    const facade: WalletFacade = await WalletFacade.init({
      configuration: config,
      shielded: (c) => ShieldedWallet(c).startWithSeed(seed),
      unshielded: (c) =>
        UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(createKeystore(seed, c.networkId))),
      dust: (c) => DustWallet(c).startWithSeed(seed, ledger.LedgerParameters.initialParameters().dust),
      submissionService: () => fakeSubmission,
    });

    // The facade shares this storage instance, so a pending entry written here is what the reads must surface.
    await txHistoryStorage.gotPending({ hash: 'pending-tx', identifiers: ['id-1'], submittedAt: new Date(0) });

    const entry = await facade.queryTxHistoryByHash('pending-tx');
    expect(entry).toBeDefined();
    expect(isPendingWalletEntry(entry!)).toBe(true);
    expect(entry!.hash).toBe('pending-tx');

    const all = await facade.getAllFromTxHistory();
    expect(all).toHaveLength(1);
    expect(isPendingWalletEntry(all[0])).toBe(true);
  });
});
