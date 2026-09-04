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
import * as v8 from '@midnightntwrk/wallet-sdk/ledger/v8';
import * as v9 from '@midnightntwrk/wallet-sdk/ledger/v9';
import { type FacadeState, generateRandomSeed, Token, WalletTransaction } from '@midnightntwrk/wallet-sdk';
import { Buffer } from 'buffer';
import * as rx from 'rxjs';
import { configuration, initWalletWithSeed } from '../utils.ts';

const sender = await initWalletWithSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);
const receiver = await initWalletWithSeed(Buffer.from(generateRandomSeed()));

const initialSenderState = await rx.firstValueFrom(sender.wallet.state().pipe(rx.filter((s) => s.isSynced)));
const initialBalance = initialSenderState.unshielded.balances[Token.night] ?? 0n;

// Authoring is choosing a ledger version, and the wallet says which: the version the wallets are acting at decides
// whether the bytes follow the pre-fork ledger's rules or the post-fork one's. It is read when the transaction is
// built, not once at start — a wallet that follows the chain across the fork moves from one ledger to the other, and
// the code that authors for it has to move with it. The two bodies below are the same call for call; only the module
// differs. The handle is sealed with that version, which is how the wallet knows which of its variants may read it.
const buildUnprovenTransaction = (state: FacadeState) => {
  const ttl = new Date(Date.now() + 30 * 60 * 1000);
  const output = { value: initialBalance, owner: receiver.unshieldedKeystore.getAddress(), type: Token.night };
  const authoredFor = state.activeProtocolVersion;
  const authorPreFork = () => {
    const intent = v8.Intent.new(ttl);
    intent.fallibleUnshieldedOffer = v8.UnshieldedOffer.new([], [output], []);
    return v8.Transaction.fromParts(configuration.networkId, undefined, undefined, intent);
  };
  const authorPostFork = () => {
    const intent = v9.Intent.new(ttl);
    intent.fallibleUnshieldedOffer = v9.UnshieldedOffer.new([], [output], []);
    return v9.Transaction.fromParts(configuration.networkId, undefined, undefined, intent);
  };
  // The version also picks which prover and validator answer for these bytes further down.
  return WalletTransaction.adopt(
    'Unproven',
    authoredFor < configuration.forkVersion ? authorPreFork() : authorPostFork(),
    authoredFor,
  );
};

const unprovenTx = buildUnprovenTransaction(initialSenderState);

// Stage 1: validate the unproven transaction before balancing.
// The same flag combination applies to balanceUnboundTransaction.
await sender.wallet.validateTransaction(unprovenTx, {
  flags: { enforceBalancing: false, verifySignatures: false, enforceLimits: false },
});
console.log('Validated unproven transaction (structural checks only)');

const recipe = await sender.wallet.balanceUnprovenTransaction(unprovenTx, {
  ttl: new Date(Date.now() + 30 * 60 * 1000),
});
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
    rx.filter((s) => (s.unshielded.balances[Token.night] ?? 0n) !== 0n),
  ),
);

console.log('Transfer with full validation completed');

await receiver.wallet.stop();
await sender.wallet.stop();
