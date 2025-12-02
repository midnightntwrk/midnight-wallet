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

export type PublicKeys = {
  publicKey: SignatureVerifyingKey;
  addressHex: UserAddress;
  address: string;
};

export const PublicKeys = {
  fromKeyStore: (keystore: UnshieldedKeystore): PublicKeys => {
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
  signData(data: Uint8Array): Signature;
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
  };

  return keystore;
};
