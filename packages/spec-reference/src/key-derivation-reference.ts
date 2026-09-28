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
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { BLSScalar, type Field, JubJubScalar, toScalar } from './field.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';

function sha256(a: Buffer, b: Buffer): Buffer {
  return crypto.createHash('sha-256').update(a).update(b).digest();
}

export function sampleBytes(bytes: number, domainSeparator: Buffer, seed: Buffer): Buffer {
  const rounds = Math.ceil(bytes / 32);
  const result = Buffer.alloc(bytes);
  for (let i = 0; i < rounds; i++) {
    const indexAsBytes = Buffer.alloc(8);
    indexAsBytes.writeBigUInt64LE(BigInt(i));
    const segment = sha256(domainSeparator, sha256(indexAsBytes, seed));
    segment.copy(result, i * 32); // last segment gets truncated if overflows
  }
  return result;
}

export function sampleKey(
  seed: Buffer,
  margin: number,
  domainSeparator: Buffer,
  field: Field,
): { intermediateBytes: Buffer; key: bigint } {
  // Generating some more bytes is important to get a better distribution of keys
  const sampledBytes = sampleBytes(field.bytes + margin, domainSeparator, seed);
  return {
    key: BigInt(toScalar(sampledBytes) % field.modulus),
    intermediateBytes: sampledBytes,
  };
}

export function encryptionSecretKey(seed: Buffer): {
  intermediateBytes: Buffer;
  key: bigint;
} {
  const field = JubJubScalar;
  const domainSeparator = Buffer.from('midnight:esk', 'utf-8');
  return sampleKey(seed, 32, domainSeparator, field);
}

export function dustSecretKey(seed: Buffer): {
  intermediateBytes: Buffer;
  key: bigint;
} {
  const field = BLSScalar;
  const domainSeparator = Buffer.from('midnight:dsk', 'utf-8');
  return sampleKey(seed, 32, domainSeparator, field);
}

export function dustPK(sk: bigint): bigint {
  return ledger.DustSecretKey.fromBigint(sk).publicKey;
}

export function dustKeys(seed: Buffer): {
  secretKey: {
    key: bigint;
    intermediateBytes: Buffer;
  };
  publicKey: bigint;
} {
  const sk = dustSecretKey(seed);
  return {
    secretKey: sk,
    publicKey: dustPK(sk.key),
  };
}

export function coinKeys(seed: Buffer): {
  secretKey: Buffer;
  publicKey: Buffer;
} {
  const secretKey = sha256(Buffer.from('midnight:csk', 'utf-8'), seed);
  return {
    secretKey,
    publicKey: sha256(Buffer.from('midnight:zswap-pk[v1]', 'utf-8'), secretKey),
  };
}

export function unshieldedKeyPairFromUniformBytes(secretKeyBytes: Buffer): {
  secretKey: Buffer | null;
  publicKey: Buffer | null;
} {
  try {
    return {
      secretKey: secretKeyBytes,
      publicKey: Buffer.from(schnorr.getPublicKey(secretKeyBytes)),
    };
  } catch {
    // Got error in deriving unshielded key pair from seed - returning null
    return {
      secretKey: null,
      publicKey: null,
    };
  }
}

export function ecdsaKeyPairFromUniformBytes(secretKeyBytes: Buffer): {
  secretKey: Buffer | null;
  publicKey: Buffer | null;
} {
  try {
    const order = secp256k1.Point.CURVE().n;
    const scalar = BigInt(`0x${secretKeyBytes.toString('hex')}`) % order;
    if (scalar === 0n) return { secretKey: null, publicKey: null };
    return {
      secretKey: Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex'),
      publicKey: Buffer.from(secp256k1.getPublicKey(scalar, true)),
    };
  } catch {
    return { secretKey: null, publicKey: null };
  }
}
