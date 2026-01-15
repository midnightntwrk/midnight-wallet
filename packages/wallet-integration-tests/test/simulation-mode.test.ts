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
import { ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { CustomShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  Proving,
  Simulator,
  Submission,
  Sync,
  Transacting,
  TransactionHistory,
  V1Builder,
} from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { Effect, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 100_000 });

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;

describe('Working in simulation mode', () => {
  it('allows to make transactions', async () => {
    return Effect.gen(function* () {
      const senderKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
      const receiverKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));

      const genesisMints = [
        {
          amount: 10_000_000n,
          type: shieldedTokenType,
          recipient: senderKeys,
        },
      ] as const;
      const simulator = yield* Simulator.Simulator.init(genesisMints);

      const Wallet = CustomShieldedWallet(
        {
          simulator,
          networkId: NetworkId.NetworkId.Undeployed,
        },
        new V1Builder()
          .withTransactionType<ledger.ProofErasedTransaction>()
          .withProving(Proving.makeSimulatorProvingService)
          .withCoinSelectionDefaults()
          .withTransacting(Transacting.makeSimulatorTransactingCapability)
          .withTransactionHistory(TransactionHistory.makeSimulatorTransactionHistoryCapability)
          .withSync(Sync.makeSimulatorSyncService, Sync.makeSimulatorSyncCapability)
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withSubmission(Submission.makeSimulatorSubmissionService())
          .withSerializationDefaults(),
      );

      const senderWallet = Wallet.startWithSecretKeys(senderKeys);
      const receiverWallet = Wallet.startWithSecretKeys(receiverKeys);

      yield* Effect.promise(() => senderWallet.start(senderKeys));
      yield* Effect.promise(() => receiverWallet.start(receiverKeys));

      yield* Effect.promise(() => {
        return pipe(
          senderWallet.state,
          rx.filter((s) => s.availableCoins.length > 0),
          rx.firstValueFrom,
        );
      });

      yield* Effect.promise(async () => {
        const unprovenTx = await senderWallet.transferTransaction(senderKeys, [
          {
            type: shieldedTokenType,
            amount: 42n,
            receiverAddress: await receiverWallet
              .getAddress()
              .then((addr) => ShieldedAddress.codec.encode(Wallet.configuration.networkId, addr).asString()),
          },
        ]);
        const tx = await senderWallet.finalizeTransaction(unprovenTx);
        await senderWallet.submitTransaction(tx);
      }).pipe(Effect.forkScoped);

      const finalBalance = yield* Effect.promise(() =>
        pipe(
          receiverWallet.state,
          rx.filter((state) => state.availableCoins.length > 0),
          rx.map((state) => state.balances[shieldedTokenType] ?? 0n),
          (a) => rx.firstValueFrom(a),
        ),
      );

      expect(finalBalance).toEqual(42n);
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
