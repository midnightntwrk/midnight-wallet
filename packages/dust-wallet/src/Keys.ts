import { DustPublicKey } from '@midnight-ntwrk/ledger-v6';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { DustCoreWallet } from './DustCoreWallet.js';

export type KeysCapability<TState> = {
  getDustPublicKey(state: TState): DustPublicKey;
  getDustAddress(state: TState): DustAddress;
};

export const makeDefaultKeysCapability = (): KeysCapability<DustCoreWallet> => {
  return {
    getDustPublicKey: (state: DustCoreWallet): DustPublicKey => {
      return state.publicKey.publicKey;
    },
    getDustAddress: (state: DustCoreWallet): DustAddress => {
      return new DustAddress(state.publicKey.publicKey);
    },
  };
};
