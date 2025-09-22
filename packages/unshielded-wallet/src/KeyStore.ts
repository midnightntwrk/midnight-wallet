import { UnshieldedAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import {
  addressFromKey,
  NetworkId,
  Signature,
  SignatureVerifyingKey,
  signData,
  UserAddress,
  signatureVerifyingKey,
} from '@midnight-ntwrk/ledger';
import { pipe } from 'effect';

export type PublicKey = {
  publicKey: SignatureVerifyingKey;
  address: UnshieldedAddress;
};
export const PublicKey = {
  fromKeyStore: (keystore: UnshieldedKeystore): PublicKey => {
    return {
      publicKey: keystore.getPublicKey(),
      address: pipe(
        keystore.getAddress(false),
        (str) => Buffer.from(str, 'hex'),
        (bytes) => new UnshieldedAddress(bytes),
      ),
    };
  },
};

export interface UnshieldedKeystore {
  getSecretKey(): Buffer;
  getBech32Address(): MidnightBech32m;
  getPublicKey(): SignatureVerifyingKey;
  getAddress(includeVersion?: boolean): UserAddress;
  signData(data: Uint8Array): Signature;
}

export interface Keystore {
  keystore: UnshieldedKeystore;
  getBech32Address(): MidnightBech32m;
  getPublicKey(): SignatureVerifyingKey;
}

export const createKeystore = (shieldedSeed: Uint8Array<ArrayBufferLike>, networkId: NetworkId): UnshieldedKeystore => {
  const MAJOR_VERSION = 1;
  const MINOR_VERSION = 0;

  const keystore: UnshieldedKeystore = {
    getSecretKey: () => Buffer.from([MAJOR_VERSION, MINOR_VERSION, ...shieldedSeed]),

    getBech32Address: () => {
      const address = keystore.getAddress(false);
      const addressBuffer = Buffer.from(address, 'hex');
      return UnshieldedAddress.codec.encode(networkId, new UnshieldedAddress(addressBuffer));
    },

    getPublicKey: () => signatureVerifyingKey(keystore.getSecretKey().toString('hex')),

    getAddress: (includeVersion = true) => {
      const publicKey = keystore.getPublicKey();
      const address = addressFromKey(publicKey);

      return includeVersion ? address : address.slice(4);
    },

    signData: (data: Uint8Array) => signData(keystore.getSecretKey().toString('hex'), data),
  };

  return keystore;
};
