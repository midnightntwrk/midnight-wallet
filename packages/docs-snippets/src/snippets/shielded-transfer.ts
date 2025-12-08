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
import { initWalletWithSeed, waitForDustGenerated } from '../utils.ts';
import * as rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Buffer } from 'buffer';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';

const sender = await initWalletWithSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);
const receiver = await initWalletWithSeed(Buffer.from(generateRandomSeed()));

await rx.firstValueFrom(sender.wallet.state().pipe(rx.filter((s) => s.isSynced)));
await waitForDustGenerated();

const receiverAddress = await rx.firstValueFrom(
  receiver.wallet.state().pipe(
    rx.filter((s) => s.isSynced),
    rx.map((s) => MidnightBech32m.encode('undeployed', s.shielded.address).toString()),
  ),
);

await sender.wallet
  .transferTransaction(
    sender.shieldedSecretKeys,
    sender.dustSecretKey,
    [
      {
        type: 'shielded',
        outputs: [
          {
            amount: 1_000_000n,
            receiverAddress,
            type: ledger.shieldedToken().raw,
          },
        ],
      },
    ],
    new Date(Date.now() + 30 * 60 * 1000),
  )
  .then((recipe) =>
    sender.wallet.signTransaction(recipe.transaction, (payload) => sender.unshieldedKeystore.signData(payload)),
  )
  .then((tx) => sender.wallet.finalizeTransaction({ type: 'TransactionToProve', transaction: tx }))
  .then((finalizedTransaction) => sender.wallet.submitTransaction(finalizedTransaction));

const receiverState = await rx.firstValueFrom(
  receiver.wallet.state().pipe(
    rx.filter((s) => s.isSynced),
    rx.filter((s) => s.shielded.availableCoins.length > 0),
  ),
);

console.log(
  'Shielded transfer completed; shielded balance:',
  receiverState.shielded.balances[ledger.shieldedToken().raw] ?? 0n,
);

await receiver.wallet.stop();
await sender.wallet.stop();
