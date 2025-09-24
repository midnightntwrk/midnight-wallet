import { CoreWallet } from './CoreWallet';
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

export const makeDefaultKeysCapability = (): KeysCapability<CoreWallet> => {
  return {
    getCoinPublicKey: (state: CoreWallet): ShieldedCoinPublicKey => {
      return new ShieldedCoinPublicKey(Buffer.from(state.publicKeys.coinPublicKey, 'hex'));
    },
    getEncryptionPublicKey: (state: CoreWallet): ShieldedEncryptionPublicKey => {
      return new ShieldedEncryptionPublicKey(Buffer.from(state.publicKeys.encryptionPublicKey, 'hex'));
    },
    getAddress: (state: CoreWallet): ShieldedAddress => {
      const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(state.publicKeys.coinPublicKey, 'hex'));
      const encryptionPublicKey = new ShieldedEncryptionPublicKey(
        Buffer.from(state.publicKeys.encryptionPublicKey, 'hex'),
      );
      return new ShieldedAddress(coinPublicKey, encryptionPublicKey);
    },
  };
};
