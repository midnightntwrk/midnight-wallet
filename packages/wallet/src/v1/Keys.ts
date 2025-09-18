import { V1State } from './RunningV1Variant';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

export type KeysCapability<TState> = {
  getCoinPublicKey(state: TState): ShieldedCoinPublicKey;
  getEncryptionPublicKey(state: TState): ShieldedEncryptionPublicKey;
  getAddress(state: TState): ShieldedAddress;
};

export const makeDefaultKeysCapability = (): KeysCapability<V1State> => {
  return {
    getCoinPublicKey: (state: V1State): ShieldedCoinPublicKey => {
      return new ShieldedCoinPublicKey(Buffer.from(state.publicKeys.coinPublicKey, 'hex'));
    },
    getEncryptionPublicKey: (state: V1State): ShieldedEncryptionPublicKey => {
      return new ShieldedEncryptionPublicKey(Buffer.from(state.publicKeys.encryptionPublicKey, 'hex'));
    },
    getAddress: (state: V1State): ShieldedAddress => {
      const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(state.publicKeys.coinPublicKey, 'hex'));
      const encryptionPublicKey = new ShieldedEncryptionPublicKey(
        Buffer.from(state.publicKeys.encryptionPublicKey, 'hex'),
      );
      return new ShieldedAddress(coinPublicKey, encryptionPublicKey);
    },
  };
};
