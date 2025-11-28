import type { CoreWallet } from './CoreWallet.js';
import { SignatureVerifyingKey } from '@midnight-ntwrk/ledger-v6';

export type KeysCapability<TState> = {
  getPublicKey(state: TState): SignatureVerifyingKey;
  getAddress(state: TState): string;
};

export const makeDefaultKeysCapability = (): KeysCapability<CoreWallet> => {
  return {
    getPublicKey: (state: CoreWallet): SignatureVerifyingKey => {
      return state.publicKeys.publicKey;
    },
    getAddress: (state: CoreWallet): string => {
      return state.publicKeys.address;
    },
  };
};
