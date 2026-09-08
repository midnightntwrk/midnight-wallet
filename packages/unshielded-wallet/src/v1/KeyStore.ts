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
// The ledger-v8 keystore. It lives inside the variant rather than at the package root because the two ledger
// versions disagree about what a key *is*: v8 signing and verifying keys are bare hex strings, v9's are `{tag, value}`
// records naming a signature scheme. The root `KeyStore.ts` is the v9 one, and is what the package's root entry point
// exports; this copy exists so the v8 variant can keep speaking v8 without either version's key shape leaking into the
// other's WASM calls.
import { UnshieldedAddress, type MidnightBech32m } from '@midnightntwrk/wallet-sdk-address-format';
import {
  addressFromKey,
  type Signature,
  type SignatureVerifyingKey,
  signData,
  type UserAddress,
  signatureVerifyingKey,
} from '@midnight-ntwrk/ledger-v8';
import { type NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';

export type PublicKey = {
  publicKey: SignatureVerifyingKey;
  addressHex: UserAddress;
  address: string;
};

export const PublicKey = {
  fromKeyStore: (keystore: UnshieldedKeystore): PublicKey => {
    return {
      publicKey: keystore.getPublicKey(),
      addressHex: keystore.getAddress(),
      address: keystore.getBech32Address().asString(),
    };
  },
};

export interface UnshieldedKeystore {
  getSecretKey(): Buffer;
  getBech32Address(): MidnightBech32m;
  getPublicKey(): SignatureVerifyingKey;
  getAddress(): UserAddress;
  /** The synchronous in-process signing primitive. */
  signData(data: Uint8Array): Signature;
  /**
   * Async counterpart of {@link signData} that conforms to the SDK's signer callback shape (`(data) =>
   * Promise<Signature>`), so the keystore can be passed directly to `signUnprovenTransaction`/… without wrapping each
   * call site. It simply resolves the synchronous {@link signData}; out-of-process backends (MPC, HSM) supply their own
   * async signer.
   */
  signDataAsync: (data: Uint8Array) => Promise<Signature>;
}

export const createKeystore = (
  secretKey: Uint8Array<ArrayBufferLike>,
  networkId: NetworkId.NetworkId,
): UnshieldedKeystore => {
  const keystore: UnshieldedKeystore = {
    getSecretKey: () => Buffer.from(secretKey),

    getBech32Address: () => {
      const address = keystore.getAddress();
      const addressBuffer = Buffer.from(address, 'hex');
      return UnshieldedAddress.codec.encode(networkId, new UnshieldedAddress(addressBuffer));
    },

    getPublicKey: () => signatureVerifyingKey(keystore.getSecretKey().toString('hex')),

    getAddress: () => addressFromKey(keystore.getPublicKey()),

    signData: (data: Uint8Array) => signData(keystore.getSecretKey().toString('hex'), data),

    signDataAsync: (data: Uint8Array) => Promise.resolve(keystore.signData(data)),
  };

  return keystore;
};
