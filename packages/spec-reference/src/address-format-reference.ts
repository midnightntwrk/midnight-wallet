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
import { bech32m } from '@scure/base';
import * as crypto from 'node:crypto';
import { BLSScalar, JubJubScalar } from './field.js';
import * as subsquidScale from '@subsquid/scale-codec';

export const Bech32m: unique symbol = Symbol('Bech32m');

export type FormatContext = {
  networkId: string | null;
};

export class MidnightBech32m {
  public static readonly prefix = 'mn';

  static validateSegment(segmentName: string, segment: string): void {
    const result = /^[A-Za-z1-9-]+$/.test(segment);
    if (!result) {
      throw new Error(
        `Segment ${segmentName}: ${segment} contains disallowed characters. Allowed characters are only numbers, latin letters and a hyphen`,
      );
    }
  }

  static parse(bech32string: string): MidnightBech32m {
    const bech32parsed = bech32m.decodeToBytes(bech32string);
    const [prefix, type, network = null] = bech32parsed.prefix.split('_');
    if (prefix != MidnightBech32m.prefix) {
      throw new Error(`Expected prefix ${MidnightBech32m.prefix}`);
    }
    if (type == undefined) {
      throw new Error(`Did not find address type information`);
    }
    MidnightBech32m.validateSegment('type', type);
    if (network != null) {
      MidnightBech32m.validateSegment('network', network);
    }

    return new MidnightBech32m(type, network, Buffer.from(bech32parsed.bytes));
  }

  public readonly type: string;
  public readonly network: string | null;
  public readonly data: Buffer;

  constructor(type: string, network: string | null, data: Buffer) {
    MidnightBech32m.validateSegment('type', type);
    if (network != null) {
      MidnightBech32m.validateSegment('network', network);
    }

    this.type = type;
    this.network = network;
    this.data = data;
  }

  toString(): string {
    const networkSegment = this.network == null ? '' : `_${this.network}`;
    return bech32m.encode(`${MidnightBech32m.prefix}_${this.type}${networkSegment}`, bech32m.toWords(this.data), false);
  }
}

export class Bech32mCodec<T> {
  public readonly type: string;
  public readonly dataToBytes: (data: T) => Buffer;
  public readonly dataFromBytes: (bytes: Buffer) => T;

  constructor(type: string, dataToBytes: (data: T) => Buffer, dataFromBytes: (bytes: Buffer) => T) {
    this.type = type;
    this.dataToBytes = dataToBytes;
    this.dataFromBytes = dataFromBytes;
  }

  encode(context: FormatContext, data: T): MidnightBech32m {
    return new MidnightBech32m(this.type, context.networkId, this.dataToBytes(data));
  }

  decode(context: FormatContext, repr: MidnightBech32m): T {
    if (repr.type != this.type) {
      throw new Error(`Expected type ${this.type}, got ${repr.type}`);
    }
    if (context.networkId != repr.network) {
      throw new Error(`Expected ${context.networkId ?? 'mainnet'} address, got ${repr.network ?? 'mainnet'} one`);
    }
    return this.dataFromBytes(repr.data);
  }
}

const ScaleBigInt = {
  encode: (data: bigint): Buffer => {
    const sink = new subsquidScale.ByteSink();
    sink.compact(data);
    return Buffer.from(sink.toBytes());
  },
  decode: (repr: Uint8Array): bigint => {
    const src = new subsquidScale.Src(repr);
    const res = src.compact();
    src.assertEOF();
    return BigInt(res);
  },
};

export class UnshieldedAddress {
  static readonly length = 32;

  static readonly codec = new Bech32mCodec<UnshieldedAddress>(
    'addr',
    (addr) => addr.data,
    (repr) => new UnshieldedAddress(repr),
  );

  [Bech32m] = UnshieldedAddress.codec;

  public readonly data: Buffer;

  constructor(data: Buffer) {
    if (data.length != UnshieldedAddress.length) {
      throw new Error('Unshielded address needs to be 32 bytes long');
    }
    this.data = data;
  }

  static fromSchnorrPublicKey(xOnlyPublicKey: Buffer): UnshieldedAddress {
    return new UnshieldedAddress(crypto.hash('sha-256', xOnlyPublicKey, 'buffer'));
  }

  static fromEcdsaPublicKey(compressedPublicKey: Buffer): UnshieldedAddress {
    return new UnshieldedAddress(
      crypto.hash('sha-256', Buffer.concat([Buffer.from('midnight:ecdsa:', 'utf-8'), compressedPublicKey]), 'buffer'),
    );
  }
}

export class ShieldedEncryptionSecretKey {
  static readonly codec = new Bech32mCodec<ShieldedEncryptionSecretKey>(
    'shield-esk',
    (esk) => esk.serialize(),
    (repr) => ShieldedEncryptionSecretKey.deserialize(repr),
  );

  static deserialize(repr: Uint8Array): ShieldedEncryptionSecretKey {
    return new ShieldedEncryptionSecretKey(ScaleBigInt.decode(repr));
  }

  [Bech32m] = ShieldedEncryptionSecretKey.codec;

  private readonly wrapped: bigint;

  // There are some bits in serialization of field elements and elliptic curve points, that are hard to replicate
  // Thus using zswap implementation directly for serialization purposes
  constructor(toWrap: bigint) {
    if (toWrap >= JubJubScalar.modulus) {
      throw new Error('Encryption secret key is too large');
    }
    this.wrapped = toWrap;
  }

  serialize(): Buffer {
    return ScaleBigInt.encode(this.wrapped);
  }
}

export class ShieldedCoinPublicKey {
  static readonly length = 32;

  static readonly codec: Bech32mCodec<ShieldedCoinPublicKey> = new Bech32mCodec(
    'shield-cpk',
    (cpk) => cpk.data,
    (repr) => new ShieldedCoinPublicKey(repr),
  );

  [Bech32m] = ShieldedCoinPublicKey.codec;

  public readonly data: Buffer;

  constructor(data: Buffer) {
    if (data.length != ShieldedCoinPublicKey.length) {
      throw new Error('Coin public key needs to be 32 bytes long');
    }

    this.data = data;
  }
}

export class ShieldedAddress {
  static readonly length = ShieldedCoinPublicKey.length + 32;

  static readonly codec = new Bech32mCodec<ShieldedAddress>(
    'shield-addr',
    (addr) => Buffer.concat([addr.coinPublicKey.data, addr.encryptionPublicKey]),
    (bytes) => {
      if (bytes.length != ShieldedAddress.length) {
        throw new Error('Shielded address needs to be 64 bytes long');
      }
      const coinPublicKey = new ShieldedCoinPublicKey(bytes.subarray(0, ShieldedCoinPublicKey.length));
      const encryptionPublicKey = bytes.subarray(ShieldedCoinPublicKey.length);

      return new ShieldedAddress(coinPublicKey, encryptionPublicKey);
    },
  );

  [Bech32m] = ShieldedAddress.codec;

  public readonly coinPublicKey: ShieldedCoinPublicKey;
  public readonly encryptionPublicKey: Buffer;

  constructor(coinPublicKey: ShieldedCoinPublicKey, encryptionPublicKey: Buffer) {
    this.encryptionPublicKey = encryptionPublicKey;
    this.coinPublicKey = coinPublicKey;
  }
}

export class DustAddress {
  static readonly codec: Bech32mCodec<DustAddress> = new Bech32mCodec(
    'dust',
    (daddr) => daddr.serialize(),
    (repr) => new DustAddress(ScaleBigInt.decode(repr)),
  );

  [Bech32m] = DustAddress.codec;

  public readonly data: bigint;

  constructor(data: bigint) {
    if (data >= BLSScalar.modulus) {
      throw new Error('Dust address is too large');
    }
    this.data = data;
  }

  serialize(): Buffer {
    return ScaleBigInt.encode(this.data);
  }
}
