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
import * as ledger from '@midnightntwrk/wallet-sdk/ledger/v9';
import {
  generateRandomSeed,
  ProtocolVersion,
  Token,
  type UnboundTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk';
import { Buffer } from 'buffer';
import * as rx from 'rxjs';
import { aFakeProvingProvider, initWalletWithSeed } from '../utils.ts';

/*
 * This file demonstrates the flow for "Dust sponsorship" - where the user's wallet is only used
 * for shielded or unshielded tokens (if at all), and a separate service does pay fees
 *
 * The initialization region prepares 2 involved wallets:
 * - sponsor (in this case - one of well-known pre-funded wallets)
 * - user (randomly generated) - who receives _some_ Night from the sponsor but does not register for Dust generation
 *
 * Then, the flow is executed in 3 steps:
 * 1. a transaction is prepared outside any wallet (to simulate a DApp invoking the API and force to use the balancing API)
 * 2. user wallet balances the transaction, without paying fees
 * 3. sponsor wallet pays fees for the transaction (in the real world would be a separate service)
 */

const sponsor = await initWalletWithSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);
const user = await initWalletWithSeed(Buffer.from(generateRandomSeed()));
const nightAmountToSend = 1000n * 10n ** 6n;

const initialSenderState = await sponsor.wallet.waitForSyncedState();
const initialBalance = initialSenderState.unshielded.balances[Token.night] ?? 0n;

await sponsor.wallet
  .transferTransaction(
    [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: nightAmountToSend,
            receiverAddress: await user.wallet.unshielded.getAddress(),
            type: Token.night,
          },
        ],
      },
    ],
    { ttl: new Date(Date.now() + 30 * 60 * 1000) },
  )
  .then((recipe) => sponsor.wallet.signRecipe(recipe, sponsor.unshieldedKeystore.signDataAsync))
  .then((recipe) => sponsor.wallet.finalizeRecipe(recipe))
  .then((tx) => sponsor.wallet.submitTransaction(tx));

const userReceivedNight = await rx.firstValueFrom(
  user.wallet.state().pipe(
    rx.filter((state) => state.isSynced),
    rx.filter((state) => state.unshielded.balances[Token.night] > 0n),
  ),
);
console.log('User received night for main transaction', userReceivedNight.unshielded.balances[Token.night]);

const prepareTransactionToBalance = async (): Promise<UnboundTx> => {
  const unshieldedOffer = ledger.UnshieldedOffer.new(
    [],
    [
      {
        value: nightAmountToSend,
        owner: sponsor.unshieldedKeystore.getAddress(),
        type: Token.night,
      },
    ],
    [],
  );
  const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
  intent.fallibleUnshieldedOffer = unshieldedOffer;
  const unprovenTransaction = ledger.Transaction.fromParts('undeployed', undefined, undefined, intent);
  // Fake proving will work here as no proofs are involved. This is a major difference compared to real flow
  const proven = await unprovenTransaction.prove(
    aFakeProvingProvider,
    ledger.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel,
  );
  // Sealed with the protocol version the ledger module above serves: a transaction an application built for itself is
  // handed to the wallet as a handle, saying which ledger version made it.
  return WalletTransaction.adopt('Unbound', proven, ProtocolVersion.MinSupportedVersion);
};
//Transaction as DApp could prepare it
const transactionToBalance = await prepareTransactionToBalance();

// Balanced by user without paying fees
const transactionWithoutFees = await user.wallet
  .balanceUnboundTransaction(transactionToBalance, {
    ttl: new Date(Date.now() + 30 * 60 * 1000),
    tokenKindsToBalance: ['shielded', 'unshielded'],
  })
  .then((recipe) => user.wallet.signRecipe(recipe, user.unshieldedKeystore.signDataAsync))
  .then((tx) => user.wallet.finalizeRecipe(tx));

// With sponsor paying fees and submitting transaction
await sponsor.wallet
  .balanceFinalizedTransaction(transactionWithoutFees, {
    ttl: new Date(Date.now() + 30 * 60 * 1000),
    tokenKindsToBalance: ['dust'],
  })
  .then((recipe) => sponsor.wallet.signRecipe(recipe, sponsor.unshieldedKeystore.signDataAsync))
  .then((recipe) => sponsor.wallet.finalizeRecipe(recipe))
  .then((finalizedTransaction) => sponsor.wallet.submitTransaction(finalizedTransaction));

const finalSponsorState = await rx.firstValueFrom(
  sponsor.wallet.state().pipe(
    rx.filter((s) => s.isSynced),
    rx.filter((s) => s.pending.length === 0),
  ),
);
const finalUserState = await user.wallet.waitForSyncedState();

console.log('Sponsored transfer completed');
console.log(
  'Did sponsor receive their night back?',
  (finalSponsorState.unshielded.balances[Token.night] ?? 0n) === initialBalance,
);
console.log('Did user spent all the Night?', (finalUserState.unshielded.balances[Token.night] ?? 0n) === 0n);

await user.wallet.stop();
await sponsor.wallet.stop();
