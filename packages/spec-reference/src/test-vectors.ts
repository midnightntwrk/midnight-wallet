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
import {
  type FormatContext,
  type Bech32mCodec,
  ShieldedAddress,
  ShieldedEncryptionSecretKey,
  ShieldedCoinPublicKey,
  DustAddress,
  UnshieldedAddress,
} from './address-format-reference.js';
import { fromScalar, JubJubScalar, BLSScalar } from './field.js';
import {
  encryptionSecretKey,
  dustSecretKey,
  coinKeys,
  unshieldedKeyPairFromUniformBytes,
  ecdsaKeyPairFromUniformBytes,
  dustKeys,
} from './key-derivation-reference.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';

type AddressEntry = { hex: string; bech32m: string };
type NullableAddressEntry = { hex: string | null; bech32m: string | null };

export type KeyDerivationVector = {
  seed: string;
  unshielded: { secretKey: string | null; publicKey: string | null };
  ecdsa: { secretKey: string | null; publicKey: string | null };
  encryption: { secretKeyRepr: string; secretKeyDecimal: string; secretKeyIntermediateBytes: string };
  dust: { secretKeyRepr: string; secretKeyDecimal: string; secretKeyIntermediateBytes: string };
  coin: { secretKey: string; publicKey: string };
};

export type AddressVector = {
  seed: string;
  networkId: string | null;
  unshieldedAddress: NullableAddressEntry;
  ecdsaAddress: NullableAddressEntry;
  shieldedAddress: AddressEntry;
  dustAddress: AddressEntry;
  shieldedESK: AddressEntry;
  shieldedCPK: AddressEntry;
};

export type TestVectors = {
  keyDerivation: KeyDerivationVector[];
  addresses: AddressVector[];
};

export const networkIds = [null, 'my-private-net', 'devnet', 'testnet', 'my-private-net-5']; //null stands for mainnet
export const seeds = [
  Buffer.alloc(32, 0),
  Buffer.alloc(32, 1),
  Buffer.alloc(32, 2),
  Buffer.alloc(32, 4),
  Buffer.alloc(32, 8),
  Buffer.alloc(32, 16),
  Buffer.alloc(32, 32),
  Buffer.alloc(32, 64),
  Buffer.alloc(32, 255),
  Buffer.from('b49408db310c043ab736fb57a98e15c8cedbed4c38450df3755ac9726ee14d0c', 'hex'), //random
  Buffer.from('06004625b6cb2ccead21b15fee2a940c404365702b697b4721bfeecfc6b1b15e', 'hex'), //random
  Buffer.from('215ca8a6923ec73f241c92ef702ccfc277aa5856bc94f59afa7e82ec94547850', 'hex'), //random
  Buffer.from('4c684b618deccc0c7609536b81f6ea25f223c472c63b11fc440be8e79af6c1b1', 'hex'), //esk 33 bytes
  Buffer.from('480d28c2b74b14d4a38b4fffe8405c10a85d819d009e2c27fffaba514f6c345d', 'hex'), //esk 32 bytes
  Buffer.from('a84e2e6675e991876f75c9918d9e86edfeb431b0b44a019980c95a36a27be45c', 'hex'), //esk 31 bytes
  Buffer.from('6f0ca9ff74fc082d5ab72f996f682d9831da8f79f731a6a48159665df22b6c71', 'hex'), //esk 30 bytes
  Buffer.from('f4f9986bb7e602d1333267ce7c4320a5837c9710b95118639ee6c27f4ed55334', 'hex'), //dpk 33 bytes
  Buffer.from('37ec63328c318df8cf32722fa7ff0b75c389e38c7c7e9e9da32e09338e2b9351', 'hex'), //dpk 32 bytes
  Buffer.from('a48b298c95152242413880fb8a57d348b7e1d37d669634c0ae1d7b363a7a140d', 'hex'), //dpk 31 bytes
  Buffer.from('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141', 'hex'), // secp256k1 order → ECDSA null
];

export function generateKeyDerivationTestVectors(seeds: Buffer[]): KeyDerivationVector[] {
  return seeds.map((seed) => {
    const esk = encryptionSecretKey(seed);
    const dsk = dustSecretKey(seed);
    const coinKeyPair = coinKeys(seed);
    const unshieldedKeyPair = unshieldedKeyPairFromUniformBytes(seed); //In this case the seed is the secret key, matching HD Wallet behavior
    const ecdsaKeyPair = ecdsaKeyPairFromUniformBytes(seed);
    return {
      seed: seed.toString('hex'),
      unshielded: {
        secretKey: unshieldedKeyPair.secretKey?.toString('hex') ?? null,
        publicKey: unshieldedKeyPair.publicKey?.toString('hex') ?? null,
      },
      ecdsa: {
        secretKey: ecdsaKeyPair.secretKey?.toString('hex') ?? null,
        publicKey: ecdsaKeyPair.publicKey?.toString('hex') ?? null,
      },
      encryption: {
        secretKeyRepr: fromScalar(esk.key, JubJubScalar).toString('hex'),
        secretKeyDecimal: esk.key.toString(10),
        secretKeyIntermediateBytes: esk.intermediateBytes.toString('hex'),
      },
      dust: {
        secretKeyRepr: fromScalar(dsk.key, BLSScalar).toString('hex'),
        secretKeyDecimal: dsk.key.toString(10),
        secretKeyIntermediateBytes: dsk.intermediateBytes.toString('hex'),
      },
      coin: {
        secretKey: coinKeyPair.secretKey.toString('hex'),
        publicKey: coinKeyPair.publicKey.toString('hex'),
      },
    };
  });
}

export function generateAddressFormattingTestVectors(seeds: Buffer[]): AddressVector[] {
  const mkFormatterNullable =
    <T>(formatter: (item: T) => { hex: string; bech32m: string }) =>
    (item: null | T): { hex: string | null; bech32m: string | null } => {
      return item == null ? { hex: null, bech32m: null } : formatter(item);
    };

  const mkFormatter =
    <T>(
      context: FormatContext,
      type: {
        codec: Bech32mCodec<T>;
      },
    ) =>
    (item: T): { hex: string; bech32m: string } => {
      return {
        hex: type.codec.dataToBytes(item).toString('hex'),
        bech32m: type.codec.encode(context, item).toString(),
      };
    };

  const contexts = seeds.flatMap((seed) => networkIds.map((networkId) => ({ seed, networkId })));
  return contexts.map(({ seed, networkId }) => {
    const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(seed);
    const coinKeyPair = coinKeys(seed);
    const esk = encryptionSecretKey(seed);
    const unshieldedKeyPair = unshieldedKeyPairFromUniformBytes(seed);
    const ecdsaKeyPair = ecdsaKeyPairFromUniformBytes(seed);
    const dustKeyPair = dustKeys(seed);

    const shieldedAddressFormatter = mkFormatter({ networkId }, ShieldedAddress);
    const shieldedESKFormatter = mkFormatter({ networkId }, ShieldedEncryptionSecretKey);
    const shieldedCPKFormatter = mkFormatter({ networkId }, ShieldedCoinPublicKey);
    const dustAddressFormatter = mkFormatter({ networkId }, DustAddress);
    const unshieldedAddressFormatter = mkFormatterNullable(mkFormatter({ networkId }, UnshieldedAddress));

    return {
      seed: seed.toString('hex'),
      networkId,
      unshieldedAddress: unshieldedAddressFormatter(
        unshieldedKeyPair.publicKey ? UnshieldedAddress.fromSchnorrPublicKey(unshieldedKeyPair.publicKey) : null,
      ),
      ecdsaAddress: unshieldedAddressFormatter(
        ecdsaKeyPair.publicKey ? UnshieldedAddress.fromEcdsaPublicKey(ecdsaKeyPair.publicKey) : null,
      ),
      shieldedAddress: shieldedAddressFormatter(
        new ShieldedAddress(
          new ShieldedCoinPublicKey(coinKeyPair.publicKey),
          Buffer.from(shieldedKeys.encryptionPublicKey, 'hex'),
        ),
      ),
      dustAddress: dustAddressFormatter(new DustAddress(dustKeyPair.publicKey)),
      shieldedESK: shieldedESKFormatter(new ShieldedEncryptionSecretKey(esk.key)),
      shieldedCPK: shieldedCPKFormatter(new ShieldedCoinPublicKey(coinKeyPair.publicKey)),
    };
  });
}

export function generateTestVectors(seeds: Buffer[]): TestVectors {
  return {
    keyDerivation: generateKeyDerivationTestVectors(seeds),
    addresses: generateAddressFormattingTestVectors(seeds),
  };
}
