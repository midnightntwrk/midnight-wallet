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
import * as crypto from 'node:crypto';
import { expect, test } from 'vitest';
import {
  Bech32m,
  type Bech32mCodec,
  DustAddress,
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionSecretKey,
  UnshieldedAddress,
} from './address-format-reference.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import {
  coinKeys,
  dustKeys,
  ecdsaKeyPairFromUniformBytes,
  encryptionSecretKey,
  unshieldedKeyPairFromUniformBytes,
} from './key-derivation-reference.js';

const initial = (): number => {
  return Math.ceil((Math.random() * Number.MAX_SAFE_INTEGER) / 2);
};
const generateSeeds = (initialSeed: number, amount: number): readonly Buffer[] => {
  return Array.from({ length: amount }, (_, i) =>
    crypto.hash('sha256', (initialSeed + i).toString(16).padStart(32 * 2, '0'), 'buffer'),
  );
};

const toBech32 = <T extends { [Bech32m]: Bech32mCodec<T> }>(data: T): MidnightBech32m => {
  return data[Bech32m].encode({ networkId: null }, data);
};

const equals = <T extends { [Bech32m]: Bech32mCodec<T> }>(a: T, b: T): boolean => {
  const aData = a[Bech32m].dataToBytes(a);
  const bData = b[Bech32m].dataToBytes(b);
  const result = aData.equals(bData);
  return result;
};

const testParity = <T extends { [Bech32m]: Bech32mCodec<T> }>(impls: {
  implSpec: (seed: Buffer) => T;
  implLedger: (seed: Buffer) => T;
}) => {
  return (seeds: readonly Buffer[]) => {
    for (const seed of seeds) {
      const specKey = impls.implSpec(seed);
      const ledgerKey = impls.implLedger(seed);
      const specBech32 = toBech32(specKey).toString();
      const ledgerBech32 = toBech32(ledgerKey).toString();

      expect(specKey).toEqual(ledgerKey);
      expect(specBech32).toBe(ledgerBech32);
    }
  };
};

const testParityBinary = (impls: {
  implSpec: (seed: Buffer) => Uint8Array;
  implLedger: (seed: Buffer) => Uint8Array;
}) => {
  return (seeds: readonly Buffer[]) => {
    for (const seed of seeds) {
      const specKey = impls.implSpec(seed);
      const ledgerKey = impls.implLedger(seed);

      expect(specKey).toEqual(ledgerKey);
    }
  };
};

const testRoundtrip =
  <T extends { [Bech32m]: Bech32mCodec<T> }>(implementation: (seed: Buffer) => T | null) =>
  (seeds: readonly Buffer[]) => {
    for (const seed of seeds) {
      const data = implementation(seed);
      if (data == null) {
        continue;
      }
      const asBech32 = toBech32(data).toString();
      const fromBech32 = data[Bech32m].decode({ networkId: null }, MidnightBech32m.parse(asBech32));

      expect(equals(data, fromBech32)).toBe(true);
    }
  };

const testWrongCredentialType =
  <T extends { [Bech32m]: Bech32mCodec<T> }>(implementation: (seed: Buffer) => T | null) =>
  (seeds: readonly Buffer[]) => {
    for (const seed of seeds) {
      const data = implementation(seed);
      if (data == null) {
        continue;
      }
      const asBech32 = toBech32(data);
      const withChangedCredential = new MidnightBech32m('foo', asBech32.network, asBech32.data).toString();

      expect(() =>
        data[Bech32m].decode({ networkId: asBech32.network }, MidnightBech32m.parse(withChangedCredential)),
      ).toThrow();
    }
  };

const testWrongNetwork =
  <T extends { [Bech32m]: Bech32mCodec<T> }>(implementation: (seed: Buffer) => T | null) =>
  (seeds: readonly Buffer[]) => {
    for (const seed of seeds) {
      const data = implementation(seed);
      if (data == null) {
        continue;
      }
      const asBech32 = toBech32(data);
      const withChangedNetwork = new MidnightBech32m(asBech32.type, 'foo', asBech32.data).toString();
      expect(() => data[Bech32m].decode({ networkId: null }, MidnightBech32m.parse(withChangedNetwork))).toThrow();
    }
  };

const keysFromSeed = (seed: Buffer) => {
  const keys: ledger.ZswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(seed);
  const coinKeyPair = coinKeys(seed);

  return { keys, coinKeyPair };
};

const saddrSpec = (seed: Buffer) => {
  const keys = keysFromSeed(seed);
  return new ShieldedAddress(
    new ShieldedCoinPublicKey(keys.coinKeyPair.publicKey),
    Buffer.from(keys.keys.encryptionPublicKey, 'hex'),
  );
};

const saddrZswap = (seed: Buffer) => {
  const keys = keysFromSeed(seed);
  return new ShieldedAddress(
    new ShieldedCoinPublicKey(Buffer.from(keys.keys.coinPublicKey, 'hex')),
    Buffer.from(keys.keys.encryptionPublicKey, 'hex'),
  );
};

const scpkSpec = (seed: Buffer) => {
  const keys = keysFromSeed(seed);
  return new ShieldedCoinPublicKey(keys.coinKeyPair.publicKey);
};

const scpkZswap = (seed: Buffer) => {
  const keys = keysFromSeed(seed);
  return new ShieldedCoinPublicKey(Buffer.from(keys.keys.coinPublicKey, 'hex'));
};

const sesk = (seed: Buffer) => {
  const keys = keysFromSeed(seed);
  return ShieldedEncryptionSecretKey.deserialize(
    keys.keys.encryptionSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize(),
  );
};

const unshieldedAddr = (seed: Buffer) => {
  const keys = unshieldedKeyPairFromUniformBytes(seed);
  return keys.publicKey != null ? UnshieldedAddress.fromSchnorrPublicKey(keys.publicKey) : null;
};

const ecdsaAddr = (seed: Buffer) => {
  const keys = ecdsaKeyPairFromUniformBytes(seed);
  return keys.publicKey != null ? UnshieldedAddress.fromEcdsaPublicKey(keys.publicKey) : null;
};

const dustAddr = (seed: Buffer) => {
  const dustKeyPair = dustKeys(seed);
  return new DustAddress(dustKeyPair.publicKey);
};

const dustAddrLedger = (seed: Buffer) => {
  const dustSk = ledger.DustSecretKey.fromSeed(seed);
  return new DustAddress(dustSk.publicKey);
};

const schnorrAddrLedger = (seed: Buffer): UnshieldedAddress | null => {
  const keys = unshieldedKeyPairFromUniformBytes(seed);
  if (keys.secretKey == null) return null;
  const sk = ledger9.signingKeyFromBip340(keys.secretKey);
  const vk = ledger9.signatureVerifyingKey(sk);
  const addr = ledger9.addressFromKey(vk);
  return new UnshieldedAddress(Buffer.from(ledger9.encodeUserAddress(addr)));
};

const ecdsaAddrLedger = (seed: Buffer): UnshieldedAddress | null => {
  const keys = ecdsaKeyPairFromUniformBytes(seed);
  if (keys.secretKey == null) return null;
  const sk: ledger9.SigningKey = { tag: 'ecdsa', value: keys.secretKey.toString('hex') };
  const vk = ledger9.signatureVerifyingKey(sk);
  const addr = ledger9.addressFromKey(vk);
  return new UnshieldedAddress(Buffer.from(ledger9.encodeUserAddress(addr)));
};

const seeds = generateSeeds(initial(), 1_000);

test('Shielded address parity', () => testParity({ implSpec: saddrSpec, implLedger: saddrZswap })(seeds));

test('Shielded coin key parity', () => testParity({ implSpec: scpkSpec, implLedger: scpkZswap })(seeds));

test('Shielded encryption secret key parity', () =>
  testParity({
    implSpec: (seed) => {
      const esk = encryptionSecretKey(seed);
      return new ShieldedEncryptionSecretKey(esk.key);
    },
    implLedger: (seed) => {
      const keys = ledger.ZswapSecretKeys.fromSeed(seed);
      return ShieldedEncryptionSecretKey.deserialize(
        keys.encryptionSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize(),
      );
    },
  })(seeds));

test('Shielded encryption secret key parity #2', () =>
  testParityBinary({
    implSpec: (seed) => {
      const esk = encryptionSecretKey(seed);
      return new ShieldedEncryptionSecretKey(esk.key).serialize();
    },
    implLedger: (seed) => {
      const keys = ledger.ZswapSecretKeys.fromSeed(seed);
      return keys.encryptionSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize();
    },
  }));

test('Dust key parity', () => testParity({ implSpec: dustAddr, implLedger: dustAddrLedger })(seeds));

test('Schnorr unshielded address parity', () =>
  testParity({
    implSpec: unshieldedAddr as (s: Buffer) => UnshieldedAddress,
    implLedger: schnorrAddrLedger as (s: Buffer) => UnshieldedAddress,
  })(seeds.filter((s) => unshieldedKeyPairFromUniformBytes(s).secretKey !== null)));

test('ECDSA unshielded address parity', () =>
  testParity({
    implSpec: ecdsaAddr as (s: Buffer) => UnshieldedAddress,
    implLedger: ecdsaAddrLedger as (s: Buffer) => UnshieldedAddress,
  })(seeds.filter((s) => ecdsaKeyPairFromUniformBytes(s).secretKey !== null)));

test('Shielded address spec roundtrip', () => testRoundtrip(saddrSpec)(seeds));
test('Shielded address zswap roundtrip', () => testRoundtrip(saddrZswap)(seeds));
test('Shielded coin public key spec roundtrip', () => testRoundtrip(scpkSpec)(seeds));
test('Shielded coin public key zswap roundtrip', () => testRoundtrip(scpkZswap)(seeds));
test('Shielded encryption secret key roundtrip', () => testRoundtrip(sesk)(seeds));

test('Shielded address spec wrong credential type', () => testWrongCredentialType(saddrSpec)(seeds));
test('Shielded address zswap wrong credential type', () => testWrongCredentialType(saddrZswap)(seeds));
test('Shielded coin public key spec wrong credential type', () => testWrongCredentialType(scpkSpec)(seeds));
test('Shielded coin public key zswap wrong credential type', () => testWrongCredentialType(scpkZswap)(seeds));
test('Shielded encryption secret key wrong credential type', () => testWrongCredentialType(sesk)(seeds));

test('Shielded address spec wrong network', () => testWrongNetwork(saddrSpec)(seeds));
test('Shielded address zswap wrong network', () => testWrongNetwork(saddrZswap)(seeds));
test('Shielded coin public key spec wrong network', () => testWrongNetwork(scpkSpec)(seeds));
test('Shielded coin public key zswap wrong network', () => testWrongNetwork(scpkZswap)(seeds));
test('Shielded encryption secret key wrong network', () => testWrongNetwork(sesk)(seeds));

test('Unshielded address roundtrip', () => testRoundtrip(unshieldedAddr)(seeds));
test('Unshielded address wrong credential type', () => testWrongCredentialType(unshieldedAddr)(seeds));
test('Unshielded address wrong network', () => testWrongNetwork(unshieldedAddr)(seeds));

test('Dust address roundtrip', () => testRoundtrip(dustAddr)(seeds));
test('Dust address wrong network', () => testWrongNetwork(dustAddr)(seeds));
test('Dust address wrong credential', () => testWrongCredentialType(dustAddr)(seeds));

test('ECDSA unshielded address roundtrip', () => testRoundtrip(ecdsaAddr)(seeds));
test('ECDSA unshielded address wrong credential type', () => testWrongCredentialType(ecdsaAddr)(seeds));
test('ECDSA unshielded address wrong network', () => testWrongNetwork(ecdsaAddr)(seeds));
