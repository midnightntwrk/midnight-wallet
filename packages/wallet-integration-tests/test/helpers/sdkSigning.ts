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
//
// Drives an async external signer (MPC, HSM) through the SDK's real signing pathway (#504). `signingService` is the
// exact service the wallet variant delegates to; `buildEcdsaTransfer` produces a genuine unshielded Night transfer
// whose input is owned by the ECDSA key derived from `secret` — the same key the matching FakeMpcCoordinator/FakeHsm
// (built from that secret) holds, so the backend's signatures authorize this transaction.
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnightntwrk/wallet-sdk-capabilities';
import { createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  CoinsAndBalances,
  CoreWallet,
  Keys,
  Signing,
  Transacting,
  UnshieldedState,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either } from 'effect';

const NIGHT = ledger.nativeToken().raw;
const networkId = NetworkId.NetworkId.Undeployed;
const ttl = DateOps.addSeconds(new Date(), 1800);
const recipient = new UnshieldedAddress(Buffer.alloc(32, 5));

/** The SDK's default signing service — the exact pathway the wallet variant uses to authorize a transaction. */
export const signingService = Signing.makeDefaultSigningService();

/**
 * Build a real unshielded Night transfer whose input is owned by the ECDSA key derived from `secret`. A
 * {@link FakeMpcCoordinator}/{@link FakeHsm} constructed from the same secret holds that key, so its async signatures
 * authorize this transaction's spend through {@link signingService}.
 */
export const buildEcdsaTransfer = (secret: Uint8Array): ledger.UnprovenTransaction => {
  const keystore = createKeystore({ kind: 'ecdsa', secret }, networkId);
  const ownerPK = PublicKey.fromKeyStore(keystore);
  const utxos = [
    new UnshieldedState.UtxoWithMeta({
      utxo: {
        value: 1_000n,
        owner: ownerPK.addressHex,
        type: NIGHT,
        intentHash: ledger.sampleIntentHash(),
        outputNo: 0,
      },
      meta: { ctime: new Date(0), registeredForDustGeneration: false },
    }),
  ];
  const wallet = CoreWallet.restore(
    UnshieldedState.UnshieldedState.restore(utxos, []),
    ownerPK,
    { appliedId: 0n, highestTransactionId: 0n },
    ProtocolVersion.ProtocolVersion(1n),
    networkId,
  );
  const transacting = Transacting.makeDefaultTransactingCapability({ networkId }, () => ({
    coinSelection: chooseCoin,
    coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability(),
    keysCapability: Keys.makeDefaultKeysCapability(),
  }));
  return transacting
    .makeTransfer(wallet, [{ amount: 100n, type: NIGHT, receiverAddress: recipient }], ttl)
    .pipe(Either.getOrThrow).transaction;
};
