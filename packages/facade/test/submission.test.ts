// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { type SubmissionService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { type DefaultConfiguration, WalletFacade } from '../src/index.js';

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
        additionalFeeOverhead: 0n,
        feeBlocksMargin: 0,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    };
    const facade: WalletFacade = await WalletFacade.init({
      configuration,
      submissionService: () => fakeSubmission,
      shielded: (config) => {
        const mockedShielded = vi.mockObject(ShieldedWallet(config).startWithShieldedSeed(seed));
        mockedShielded.start.mockResolvedValue(undefined);
        return mockedShielded;
      },
      unshielded: (config) => {
        const mockedUnshielded = vi.mockObject(
          UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(createKeystore(seed, config.networkId))),
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
    const config = {
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        additionalFeeOverhead: 0n,
        feeBlocksMargin: 0,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    };
    const seed = crypto.randomBytes(32);
    const shielded = ShieldedWallet(config).startWithShieldedSeed(seed);
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
  });
});
