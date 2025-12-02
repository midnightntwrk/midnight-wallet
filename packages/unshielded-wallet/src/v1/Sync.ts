import { Scope, Stream, Schema, pipe, Either } from 'effect';
import { CoreWallet } from './CoreWallet.js';
import { Simulator, SimulatorState } from './Simulator.js';
import { UnshieldedTransactions } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { WsSubscriptionClient, ConnectionHelper } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, WalletError } from './WalletError.js';
import { WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { TransactionHistoryCapability } from './TransactionHistory.js';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { UnshieldedTransaction, UnshieldedTransactionSchema } from '@midnight-ntwrk/wallet-sdk-unshielded-state';

export interface SyncService<TState, TUpdate> {
  updates: (state: TState) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
}

export interface SyncCapability<TState, TUpdate> {
  applyUpdate: (state: TState, update: TUpdate) => TState;
}

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
};

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
};

export type DefaultSyncContext = {
  transactionHistoryCapability: TransactionHistoryCapability<UnshieldedTransaction>;
};

const TransactionSchema = Schema.Struct({
  type: Schema.Literal('UnshieldedTransaction'),
  transaction: UnshieldedTransactionSchema,
});

const ProgressSchema = Schema.Struct({
  type: Schema.Literal('UnshieldedTransactionsProgress'),
  highestTransactionId: Schema.Number,
});

export const WalletSyncUpdateSchema = Schema.Union(TransactionSchema, ProgressSchema);

export type WalletSyncUpdate = Schema.Schema.Type<typeof WalletSyncUpdateSchema>;

const WalletSyncUpdateDecoder = Schema.decodeUnknownEither(WalletSyncUpdateSchema);

export const makeDefaultSyncService = (config: DefaultSyncConfiguration): SyncService<CoreWallet, WalletSyncUpdate> => {
  return {
    updates: (state: CoreWallet): Stream.Stream<WalletSyncUpdate, WalletError, Scope.Scope> => {
      const { indexerClientConnection } = config;

      const webSocketUrlResult = ConnectionHelper.createWebSocketUrl(
        indexerClientConnection.indexerHttpUrl,
        indexerClientConnection.indexerWsUrl,
      );

      if (Either.isLeft(webSocketUrlResult)) {
        return Stream.fail(
          new SyncWalletError(
            new Error(`Could not derive WebSocket URL from indexer HTTP URL: ${webSocketUrlResult.left.message}`),
          ),
        );
      }

      const indexerWsUrlResult = WsURL.make(webSocketUrlResult.right);

      if (Either.isLeft(indexerWsUrlResult)) {
        return Stream.fail(
          new SyncWalletError(new Error(`Invalid indexer WS URL: ${indexerWsUrlResult.left.message}`)),
        );
      }

      const indexerWsUrl = indexerWsUrlResult.right;

      const { appliedId } = state.progress;
      const { address } = state.publicKeys;

      return pipe(
        UnshieldedTransactions.run({ address, transactionId: Number(appliedId) }),
        Stream.provideLayer(WsSubscriptionClient.layer({ url: indexerWsUrl })),
        Stream.mapError((error) => new SyncWalletError(error)),
        Stream.mapEffect((subscription) => {
          const { unshieldedTransactions } = subscription;
          const { type } = unshieldedTransactions;

          if (type === 'UnshieldedTransactionsProgress') {
            return pipe(
              WalletSyncUpdateDecoder({
                type,
                highestTransactionId: unshieldedTransactions.highestTransactionId,
              }),
              Either.mapLeft((err) => new SyncWalletError(err)),
              EitherOps.toEffect,
            );
          }

          const { transaction, createdUtxos, spentUtxos } = unshieldedTransactions;
          const isRegularTransaction = transaction.type === 'RegularTransaction';
          const transactionResult = isRegularTransaction
            ? {
                status: transaction.transactionResult.status,
                segments:
                  transaction.transactionResult.segments?.map((segment) => ({
                    id: segment.id.toString(),
                    success: segment.success,
                  })) ?? null,
              }
            : null;

          return pipe(
            WalletSyncUpdateDecoder({
              type,
              transaction: {
                type: transaction.type,
                id: transaction.id,
                hash: transaction.hash,
                identifiers: isRegularTransaction ? transaction.identifiers : [],
                protocolVersion: transaction.protocolVersion,
                transactionResult,
                block: transaction.block,
                fees: isRegularTransaction ? transaction.fees : undefined,
                createdUtxos: createdUtxos.map((utxo) => ({
                  value: utxo.value,
                  owner: utxo.owner,
                  type: utxo.tokenType,
                  intentHash: utxo.intentHash,
                  outputNo: utxo.outputIndex,
                  registeredForDustGeneration: utxo.registeredForDustGeneration,
                  ctime: utxo.ctime ? utxo.ctime * 1000 : undefined,
                })),
                spentUtxos: spentUtxos.map((utxo) => ({
                  value: utxo.value,
                  owner: utxo.owner,
                  type: utxo.tokenType,
                  intentHash: utxo.intentHash,
                  outputNo: utxo.outputIndex,
                  registeredForDustGeneration: utxo.registeredForDustGeneration,
                  ctime: utxo.ctime ? utxo.ctime * 1000 : undefined,
                })),
              },
            }),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
      );
    },
  };
};

export const makeDefaultSyncCapability = (
  _config: DefaultSyncConfiguration,
  getContext: () => DefaultSyncContext,
): SyncCapability<CoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, update: WalletSyncUpdate): CoreWallet => {
      if (update.type === 'UnshieldedTransactionsProgress') {
        return CoreWallet.updateProgress(state, {
          highestTransactionId: BigInt(update.highestTransactionId),
          isConnected: true,
        });
      }

      const newState = CoreWallet.updateProgress(CoreWallet.applyTx(state, update.transaction), {
        appliedId: BigInt(update.transaction.id),
      });

      const { transactionHistoryCapability } = getContext();
      void transactionHistoryCapability.create(update.transaction);

      return newState;
    },
  };
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet) => config.simulator.state$.pipe(Stream.map((state) => ({ update: state }))),
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, _update: SimulatorSyncUpdate) => {
      return state;
      // return CoreWallet.replayEvents(state, secretKeys, events);
    },
  };
};
