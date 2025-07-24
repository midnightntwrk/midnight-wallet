import { V1State } from './RunningV1Variant';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  ShieldedEncryptionSecretKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

export type KeysCapability<TState> = {
  getCoinPublicKey(state: TState): ShieldedCoinPublicKey;
  getEncryptionPublicKey(state: TState): ShieldedEncryptionPublicKey;
  getAddress(state: TState): ShieldedAddress;
  getEncryptionSecretKey(state: TState): ShieldedEncryptionSecretKey;
};

export const makeDefaultKeysCapability = (): KeysCapability<V1State> => {
  return {
    getCoinPublicKey: (state: V1State): ShieldedCoinPublicKey => {
      return new ShieldedCoinPublicKey(Buffer.from(state.secretKeys.coinPublicKey, 'hex'));
    },
    getEncryptionPublicKey: (state: V1State): ShieldedEncryptionPublicKey => {
      return new ShieldedEncryptionPublicKey(Buffer.from(state.secretKeys.encryptionPublicKey, 'hex'));
    },
    getAddress: (state: V1State): ShieldedAddress => {
      const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(state.secretKeys.coinPublicKey, 'hex'));
      const encryptionPublicKey = new ShieldedEncryptionPublicKey(
        Buffer.from(state.secretKeys.encryptionPublicKey, 'hex'),
      );
      return new ShieldedAddress(coinPublicKey, encryptionPublicKey);
    },
    getEncryptionSecretKey: (state: V1State): ShieldedEncryptionSecretKey => {
      return new ShieldedEncryptionSecretKey(state.secretKeys.encryptionSecretKey);
    },
  };
};
