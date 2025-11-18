// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { DustPublicKey, EncryptionSecretKey, UserAddress } from '@midnight-ntwrk/ledger-v6';
import { bech32m } from '@scure/base';
import * as subsquidScale from '@subsquid/scale-codec';

export const mainnet: unique symbol = Symbol('Mainnet');
export type NetworkId = string | typeof mainnet;
const NetworkId = {
  toString: (networkId: NetworkId): string => {
    return networkId === mainnet ? 'mainnet' : networkId;
  },
};

export type FormatContext = {
  networkId: NetworkId;
};

export type Field = {
  bytes: number;
  modulus: bigint;
};

export const BLSScalar: Field = {
  bytes: 32,
  modulus: BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001'),
};

export const ScaleBigInt = {
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

export const Bech32mSymbol: unique symbol = Symbol('MidnightBech32m');
export type HasCodec<T> = { [Bech32mSymbol]: Bech32mCodec<T> };
export type CodecTarget<T> = T extends HasCodec<infer U> ? U : never;

export class MidnightBech32m {
  public static readonly prefix = 'mn';

  static encode<T extends HasCodec<T>>(networkId: NetworkId, item: T): MidnightBech32m {
    return item[Bech32mSymbol].encode(networkId, item);
  }

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
    const [prefix, type, network = mainnet] = bech32parsed.prefix.split('_');
    if (prefix != MidnightBech32m.prefix) {
      throw new Error(`Expected prefix ${MidnightBech32m.prefix}`);
    }
    MidnightBech32m.validateSegment('type', type);
    if (network != mainnet) {
      MidnightBech32m.validateSegment('network', network);
    }

    return new MidnightBech32m(type, network, Buffer.from(bech32parsed.bytes));
  }

  public readonly type: string;
  public readonly network: NetworkId;
  public readonly data: Buffer;

  constructor(type: string, network: NetworkId, data: Buffer) {
    this.data = data;
    this.network = network;
    this.type = type;
    MidnightBech32m.validateSegment('type', type);
    if (network != mainnet) {
      MidnightBech32m.validateSegment('network', network);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decode<TClass extends HasCodec<any>>(tclass: TClass, networkId: NetworkId): CodecTarget<TClass> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return tclass[Bech32mSymbol].decode(networkId, this);
  }

  asString(): string {
    const networkSegment = this.network == mainnet ? '' : `_${this.network}`;
    return bech32m.encode(`${MidnightBech32m.prefix}_${this.type}${networkSegment}`, bech32m.toWords(this.data), false);
  }

  toString(): string {
    return this.asString();
  }
}

export class Bech32mCodec<T> {
  public readonly type: string;
  public readonly dataToBytes: (data: T) => Buffer;
  public readonly dataFromBytes: (bytes: Buffer) => T;

  constructor(type: string, dataToBytes: (data: T) => Buffer, dataFromBytes: (bytes: Buffer) => T) {
    this.dataFromBytes = dataFromBytes;
    this.dataToBytes = dataToBytes;
    this.type = type;
  }

  encode(networkId: NetworkId, data: T): MidnightBech32m {
    const context = Bech32mCodec.createContext(networkId);
    return new MidnightBech32m(this.type, context.networkId, this.dataToBytes(data));
  }

  decode(networkId: NetworkId, repr: MidnightBech32m): T {
    const context = Bech32mCodec.createContext(networkId);
    if (repr.type != this.type) {
      throw new Error(`Expected type ${this.type}, got ${repr.type}`);
    }
    if (context.networkId != repr.network) {
      throw new Error(
        `Expected ${NetworkId.toString(context.networkId)} address, got ${NetworkId.toString(repr.network)} one`,
      );
    }
    return this.dataFromBytes(repr.data);
  }

  static createContext(networkId: NetworkId): FormatContext {
    if (networkId === 'mainnet') {
      return { networkId: mainnet };
    } else {
      return { networkId };
    }
  }
}

export class ShieldedAddress {
  static readonly codec = new Bech32mCodec<ShieldedAddress>(
    'shield-addr',
    (addr) => Buffer.concat([addr.coinPublicKey.data, addr.encryptionPublicKey.data]),
    (bytes) => {
      const coinPublicKey = new ShieldedCoinPublicKey(bytes.subarray(0, ShieldedCoinPublicKey.keyLength));
      const encryptionPublicKey = new ShieldedEncryptionPublicKey(bytes.subarray(ShieldedCoinPublicKey.keyLength));
      return new ShieldedAddress(coinPublicKey, encryptionPublicKey);
    },
  );

  static readonly [Bech32mSymbol]: Bech32mCodec<ShieldedAddress> = ShieldedAddress.codec;
  readonly [Bech32mSymbol]: Bech32mCodec<ShieldedAddress> = ShieldedAddress.codec;

  public readonly coinPublicKey: ShieldedCoinPublicKey;
  public readonly encryptionPublicKey: ShieldedEncryptionPublicKey;

  constructor(coinPublicKey: ShieldedCoinPublicKey, encryptionPublicKey: ShieldedEncryptionPublicKey) {
    this.encryptionPublicKey = encryptionPublicKey;
    this.coinPublicKey = coinPublicKey;
  }

  coinPublicKeyString(): string {
    return this.coinPublicKey.data.toString('hex');
  }

  encryptionPublicKeyString(): string {
    return this.encryptionPublicKey.data.toString('hex');
  }

  equals(other: ShieldedAddress): boolean {
    return this.coinPublicKey.equals(other.coinPublicKey) && this.encryptionPublicKey.equals(other.encryptionPublicKey);
  }
}

export class ShieldedEncryptionSecretKey {
  static readonly codec = new Bech32mCodec<ShieldedEncryptionSecretKey>(
    'shield-esk',
    (esk) => Buffer.from(esk.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize()),
    (repr) => new ShieldedEncryptionSecretKey(EncryptionSecretKey.deserialize(repr)),
  );

  // There are some bits in serialization of field elements and elliptic curve points, that are hard to replicate
  // Thus using zswap implementation directly for serialization purposes
  public readonly zswap: EncryptionSecretKey;

  constructor(zswap: EncryptionSecretKey) {
    this.zswap = zswap;
  }
}

export class ShieldedCoinPublicKey {
  static readonly keyLength = 32;

  static readonly codec: Bech32mCodec<ShieldedCoinPublicKey> = new Bech32mCodec(
    'shield-cpk',
    (cpk) => cpk.data,
    (repr) => new ShieldedCoinPublicKey(repr),
  );

  static fromHexString(hexString: string): ShieldedCoinPublicKey {
    return new ShieldedCoinPublicKey(Buffer.from(hexString, 'hex'));
  }

  public readonly data: Buffer;

  constructor(data: Buffer) {
    this.data = data;
    if (data.length != ShieldedCoinPublicKey.keyLength) {
      throw new Error('Coin public key needs to be 32 bytes long');
    }
  }
  toHexString(): string {
    return this.data.toString('hex');
  }

  equals(other: string): boolean;
  equals(other: ShieldedCoinPublicKey): boolean;
  equals(other: string | ShieldedCoinPublicKey): boolean {
    const otherKey = typeof other === 'string' ? ShieldedCoinPublicKey.fromHexString(other) : other;
    return otherKey.data.equals(this.data);
  }
}

export class ShieldedEncryptionPublicKey {
  static readonly keyLength = 32;

  static readonly codec: Bech32mCodec<ShieldedEncryptionPublicKey> = new Bech32mCodec(
    'shield-epk',
    (cpk) => cpk.data,
    (repr) => new ShieldedEncryptionPublicKey(repr),
  );

  static fromHexString(hexString: string): ShieldedEncryptionPublicKey {
    return new ShieldedEncryptionPublicKey(Buffer.from(hexString, 'hex'));
  }

  public readonly data: Buffer;

  constructor(data: Buffer) {
    this.data = data;
  }

  toHexString(): string {
    return this.data.toString('hex');
  }

  equals(other: string): boolean;
  equals(other: ShieldedEncryptionPublicKey): boolean;
  equals(other: string | ShieldedEncryptionPublicKey): boolean {
    const otherKey = typeof other === 'string' ? ShieldedEncryptionPublicKey.fromHexString(other) : other;
    return otherKey.data.equals(this.data);
  }
}

export class UnshieldedAddress {
  readonly data: Buffer;
  static readonly keyLength = 32;
  static readonly codec: Bech32mCodec<UnshieldedAddress> = new Bech32mCodec(
    'addr',
    (addr) => addr.data,
    (repr) => new UnshieldedAddress(repr),
  );

  static readonly [Bech32mSymbol]: Bech32mCodec<UnshieldedAddress> = UnshieldedAddress.codec;
  readonly [Bech32mSymbol]: Bech32mCodec<UnshieldedAddress> = UnshieldedAddress.codec;

  constructor(data: Buffer) {
    if (data.length != UnshieldedAddress.keyLength) {
      throw new Error('Unshielded address needs to be 32 bytes long');
    }

    this.data = data;
  }

  get hexString(): UserAddress {
    return this.data.toString('hex');
  }

  equals(other: string): boolean;
  equals(other: UnshieldedAddress): boolean;
  equals(other: string | UnshieldedAddress): boolean {
    const otherAddress = typeof other === 'string' ? new UnshieldedAddress(Buffer.from(other, 'hex')) : other;
    return otherAddress.data.equals(this.data);
  }
}

export class DustAddress {
  readonly data: bigint;

  static readonly codec: Bech32mCodec<DustAddress> = new Bech32mCodec(
    'dust',
    (daddr) => daddr.serialize(),
    (repr) => new DustAddress(ScaleBigInt.decode(repr)),
  );

  static readonly [Bech32mSymbol]: Bech32mCodec<DustAddress> = DustAddress.codec;
  readonly [Bech32mSymbol]: Bech32mCodec<DustAddress> = DustAddress.codec;

  static readonly encodePublicKey = (networkId: string, publicKey: DustPublicKey): string => {
    return DustAddress.codec.encode(networkId, new DustAddress(publicKey)).asString();
  };

  constructor(data: bigint) {
    if (data >= BLSScalar.modulus) {
      throw new Error('Dust address is too large');
    }
    this.data = data;
  }

  serialize(): Buffer {
    return ScaleBigInt.encode(this.data);
  }

  equals(other: bigint): boolean;
  equals(other: DustAddress): boolean;
  equals(other: bigint | DustAddress): boolean {
    const otherAddress = typeof other === 'bigint' ? other : other.data;
    return otherAddress === this.data;
  }
}
