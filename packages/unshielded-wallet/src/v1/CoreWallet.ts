import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { createSyncProgress, SyncProgress, SyncProgressData } from './SyncProgress.js';
import { PublicKeys } from './KeyStore.js';
import {
  UnshieldedStateAPI,
  UnshieldedTransaction,
  Utxo,
  UnshieldedStateService,
  UnshieldedState,
  UtxoNotFoundError,
} from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import { ParseError } from 'effect/ParseResult';

export type CoreWallet = Readonly<{
  state: UnshieldedStateAPI;
  publicKeys: PublicKeys;
  protocolVersion: ProtocolVersion.ProtocolVersion;
  progress: SyncProgress;
  networkId: string;
}>;

export const CoreWallet = {
  init(publicKeys: PublicKeys, networkId: string): CoreWallet {
    return Effect.gen(function* () {
      const unshieldedStateAPI = yield* UnshieldedStateService;

      return {
        state: unshieldedStateAPI,
        publicKeys,
        protocolVersion: ProtocolVersion.MinSupportedVersion,
        progress: createSyncProgress(),
        networkId,
      };
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runSync);
  },

  restore(
    unshieldedState: UnshieldedState,
    publicKeys: PublicKeys,
    syncProgress: Omit<SyncProgressData, 'isConnected'>,
    protocolVersion: ProtocolVersion.ProtocolVersion,
    networkId: string,
  ): CoreWallet {
    return Effect.gen(function* () {
      const unshieldedStateAPI = yield* UnshieldedStateService;

      return {
        state: unshieldedStateAPI,
        publicKeys,
        protocolVersion,
        progress: createSyncProgress(syncProgress),
        networkId,
      };
    }).pipe(Effect.provide(UnshieldedStateService.LiveWithState(unshieldedState)), Effect.runSync);
  },

  updateProgress(
    wallet: CoreWallet,
    { appliedId, highestTransactionId, isConnected }: Partial<SyncProgressData>,
  ): CoreWallet {
    const progress = createSyncProgress({
      appliedId: appliedId ?? wallet.progress.appliedId,
      highestTransactionId: highestTransactionId ?? wallet.progress.highestTransactionId,
      isConnected: isConnected ?? wallet.progress.isConnected,
    });
    return { ...wallet, progress };
  },

  applyTx(coreWallet: CoreWallet, tx: UnshieldedTransaction): CoreWallet {
    return Effect.gen(function* () {
      yield* coreWallet.state.applyTx(tx);

      return coreWallet;
    }).pipe(Effect.runSync);
  },

  rollbackTx(coreWallet: CoreWallet, tx: UnshieldedTransaction): CoreWallet {
    return Effect.gen(function* () {
      yield* coreWallet.state.rollbackTx(tx);

      return coreWallet;
    }).pipe(Effect.runSync);
  },

  spend(coreWallet: CoreWallet, utxos: Utxo[]): Effect.Effect<CoreWallet, ParseError | UtxoNotFoundError> {
    return Effect.gen(function* () {
      for (const utxo of utxos) {
        yield* coreWallet.state.spend(utxo);
      }

      return coreWallet;
    });
  },
};
