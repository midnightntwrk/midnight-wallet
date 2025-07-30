import { NetworkId, EncryptionSecretKey } from '@midnight-ntwrk/zswap';
import { bech32m } from '@scure/base';

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
    this.data = data;
    this.network = network;
    this.type = type;
    MidnightBech32m.validateSegment('type', type);
    if (network != null) {
      MidnightBech32m.validateSegment('network', network);
    }
  }

  asString(): string {
    const networkSegment = this.network == null ? '' : `_${this.network}`;
    return bech32m.encode(`${MidnightBech32m.prefix}_${this.type}${networkSegment}`, bech32m.toWords(this.data), false);
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

  decode(networkId: NetworkId | string | null, repr: MidnightBech32m): T {
    const context = Bech32mCodec.createContext(networkId);
    if (repr.type != this.type) {
      throw new Error(`Expected type ${this.type}, got ${repr.type}`);
    }
    if (context.networkId != repr.network) {
      throw new Error(`Expected ${context.networkId ?? 'mainnet'} address, got ${repr.network ?? 'mainnet'} one`);
    }
    return this.dataFromBytes(repr.data);
  }

  static createContext(networkId: NetworkId | string | null): FormatContext {
    if (networkId === null) {
      return { networkId: null };
    } else if (typeof networkId === 'string') {
      return { networkId };
    } else {
      return Bech32mCodec.createContextFromZswap(networkId);
    }
  }

  static createContextFromZswap(networkId: NetworkId): FormatContext {
    switch (networkId) {
      case NetworkId.DevNet:
        return { networkId: 'dev' };
      case NetworkId.MainNet:
        return { networkId: null };
      case NetworkId.TestNet:
        return { networkId: 'test' };
      case NetworkId.Undeployed:
        return { networkId: 'undeployed' };
      default:
        return { networkId: null };
    }
  }
}

export class ShieldedAddress {
  static codec = new Bech32mCodec<ShieldedAddress>(
    'shield-addr',
    (addr) => Buffer.concat([addr.coinPublicKey.data, addr.encryptionPublicKey.data]),
    (bytes) => {
      const coinPublicKey = new ShieldedCoinPublicKey(bytes.subarray(0, ShieldedCoinPublicKey.key_length));
      const encryptionPublicKey = new ShieldedEncryptionPublicKey(bytes.subarray(ShieldedCoinPublicKey.key_length));
      return new ShieldedAddress(coinPublicKey, encryptionPublicKey);
    },
  );

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
}

export class ShieldedEncryptionSecretKey {
  static codec = new Bech32mCodec<ShieldedEncryptionSecretKey>(
    'shield-esk',
    (esk) => Buffer.from(esk.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize(NetworkId.Undeployed).subarray(1)),
    (repr) =>
      new ShieldedEncryptionSecretKey(
        EncryptionSecretKey.deserialize(Buffer.concat([Buffer.of(0), repr]), NetworkId.Undeployed),
      ),
  );

  // There are some bits in serialization of field elements and elliptic curve points, that are hard to replicate
  // Thus using zswap implementation directly for serialization purposes
  public readonly zswap: EncryptionSecretKey;

  constructor(zswap: EncryptionSecretKey) {
    this.zswap = zswap;
  }
}

export class ShieldedCoinPublicKey {
  static readonly key_length = 32;

  static codec: Bech32mCodec<ShieldedCoinPublicKey> = new Bech32mCodec(
    'shield-cpk',
    (cpk) => cpk.data,
    (repr) => new ShieldedCoinPublicKey(repr),
  );

  public readonly data: Buffer;

  constructor(data: Buffer) {
    this.data = data;
    if (data.length != ShieldedCoinPublicKey.key_length) {
      throw new Error('Coin public key needs to be 32 bytes long');
    }
  }
}

export class ShieldedEncryptionPublicKey {
  static readonly key_length = 32;

  static codec: Bech32mCodec<ShieldedEncryptionPublicKey> = new Bech32mCodec(
    'shield-epk',
    (cpk) => cpk.data,
    (repr) => new ShieldedEncryptionPublicKey(repr),
  );

  public readonly data: Buffer;

  constructor(data: Buffer) {
    this.data = data;
  }
}
