import { UnshieldedAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import {
  addressFromKey,
  Signature,
  SignatureVerifyingKey,
  signData,
  UserAddress,
  signatureVerifyingKey,
} from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
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

export const createKeystore = (
  secretKey: Uint8Array<ArrayBufferLike>,
  networkId: NetworkId.NetworkId,
): UnshieldedKeystore => {
  const keystore: UnshieldedKeystore = {
    getSecretKey: () => Buffer.from(secretKey),

    getBech32Address: () => {
      const address = keystore.getAddress(false);
      const addressBuffer = Buffer.from(address, 'hex');
      return UnshieldedAddress.codec.encode(networkId, new UnshieldedAddress(addressBuffer));
    },

    getPublicKey: () => signatureVerifyingKey(keystore.getSecretKey().toString('hex')),

    getAddress: () => addressFromKey(keystore.getPublicKey()),

    signData: (data: Uint8Array) => signData(keystore.getSecretKey().toString('hex'), data),
  };

  return keystore;
};
