// TODO: remove this file once all the components migrate to ledger v6

import {
  addressFromKey,
  Signature,
  SignatureVerifyingKey,
  signData,
  UserAddress,
  signatureVerifyingKey,
} from '@midnight-ntwrk/ledger-v6';

export interface UnshieldedKeystore {
  getSecretKey(): Buffer;
  getPublicKey(): SignatureVerifyingKey;
  getAddress(includeVersion?: boolean): UserAddress;
  signData(data: Uint8Array): Signature;
}

export const createUnshieldedKeystore = (dustSeed: Uint8Array<ArrayBufferLike>): UnshieldedKeystore => {
  const keystore: UnshieldedKeystore = {
    getSecretKey: () => Buffer.from(dustSeed),

    getPublicKey: () => signatureVerifyingKey(keystore.getSecretKey().toString('hex')),

    getAddress: () => addressFromKey(keystore.getPublicKey()),

    signData: (data: Uint8Array) => signData(keystore.getSecretKey().toString('hex'), data),
  };

  return keystore;
};
