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
import { generateRandomSeed } from '@midnightntwrk/wallet-sdk';
import { Buffer } from 'buffer';
import * as rx from 'rxjs';
import { initWalletWithSeed } from '../utils.ts';

const sender = await initWalletWithSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);
const receiver = await initWalletWithSeed(Buffer.from(generateRandomSeed()));

const initialSenderState = await rx.firstValueFrom(sender.wallet.state().pipe(rx.filter((s) => s.isSynced)));
const initialBalance = initialSenderState.unshielded.balances[ledger.nativeToken().raw] ?? 0n;

const buildUnprovenTransaction = () => {
  const unshieldedOffer = ledger.UnshieldedOffer.new(
    [],
    [{ value: initialBalance, owner: receiver.unshieldedKeystore.getAddress(), type: ledger.nativeToken().raw }],
    [],
  );
  const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
  intent.fallibleUnshieldedOffer = unshieldedOffer;
  return ledger.Transaction.fromParts('undeployed', undefined, undefined, intent);
};

const unprovenTx = buildUnprovenTransaction();

// Stage 1: validate the unproven transaction before balancing.
// The same flag combination applies to balanceUnboundTransaction.
await sender.wallet.validateTransaction(unprovenTx, {
  flags: { enforceBalancing: false, verifySignatures: false, enforceLimits: false },
});
console.log('Validated unproven transaction (structural checks only)');

const recipe = await sender.wallet.balanceUnprovenTransaction(
  unprovenTx,
  { shieldedSecretKeys: sender.shieldedSecretKeys, dustSecretKey: sender.dustSecretKey },
  { ttl: new Date(Date.now() + 30 * 60 * 1000) },
);
const signedRecipe = await sender.wallet.signRecipe(recipe, sender.unshieldedKeystore.signDataAsync);
const finalizedTx = await sender.wallet.finalizeRecipe(signedRecipe);

// Stage 2: validate before submitTransaction.
// Full strictness on a fully-formed transaction. `recipe.blockData` is reused to skip a redundant fetch.
await sender.wallet.validateTransaction(finalizedTx, {
  flags: { enforceBalancing: true, verifySignatures: true, enforceLimits: true },
  blockData: signedRecipe.blockData,
});
console.log('Validated finalized transaction (full strictness)');

await sender.wallet.submitTransaction(finalizedTx);

await rx.firstValueFrom(
  receiver.wallet.state().pipe(
    rx.filter((s) => s.isSynced),
    rx.filter((s) => (s.unshielded.balances[ledger.nativeToken().raw] ?? 0n) !== 0n),
  ),
);

console.log('Transfer with full validation completed');

await receiver.wallet.stop();
await sender.wallet.stop();
