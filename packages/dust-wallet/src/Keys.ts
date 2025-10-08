import { DustPublicKey } from '@midnight-ntwrk/ledger-v6';
import { DustCoreWallet } from './DustCoreWallet';

export type KeysCapability<TState> = {
  getDustPublicKey(state: TState): DustPublicKey;
};

export const makeDefaultKeysCapability = (): KeysCapability<DustCoreWallet> => {
  return {
    getDustPublicKey: (state: DustCoreWallet): DustPublicKey => {
      return state.publicKeys.publicKey;
    },
  };
};
