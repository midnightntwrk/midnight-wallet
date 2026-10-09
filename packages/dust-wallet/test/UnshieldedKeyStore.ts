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
// TODO: remove this file once all the components migrate to ledger v6

import {
  addressFromKey,
  type Signature,
  type SignatureKind,
  type SignatureVerifyingKey,
  signData,
  type SigningKey as LedgerSigningKey,
  type UserAddress,
  signatureVerifyingKey,
} from '@midnightntwrk/ledger-v9';

export type UnshieldedSecretKey = {
  kind: SignatureKind;
  secret: Uint8Array<ArrayBufferLike>;
};

export interface UnshieldedKeystore {
  getSecretKey(): Buffer;
  getPublicKey(): SignatureVerifyingKey;
  getAddress(includeVersion?: boolean): UserAddress;
  signData(data: Uint8Array): Signature;
}

export const createUnshieldedKeystore = (secretKey: UnshieldedSecretKey): UnshieldedKeystore => {
  const ledgerSigningKey: LedgerSigningKey = {
    tag: secretKey.kind,
    value: Buffer.from(secretKey.secret).toString('hex'),
  };

  const keystore: UnshieldedKeystore = {
    getSecretKey: () => Buffer.from(secretKey.secret),

    getPublicKey: () => signatureVerifyingKey(ledgerSigningKey),

    getAddress: () => addressFromKey(keystore.getPublicKey()),

    signData: (data: Uint8Array) => signData(ledgerSigningKey, data),
  };

  return keystore;
};
