import { Effect, Layer, Context, Stream, pipe, Schema, Data, Scope } from 'effect';
import { UnshieldedTransactions } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { UnshieldedTransactionSchema } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import { WsSubscriptionClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';

const TransactionSchema = Schema.Struct({
  type: Schema.Literal('UnshieldedTransaction'),
  transaction: UnshieldedTransactionSchema,
});

const ProgressSchema = Schema.Struct({
  type: Schema.Literal('UnshieldedTransactionsProgress'),
  highestTransactionId: Schema.Number,
});

export const UnshieldedUpdateSchema = Schema.Union(TransactionSchema, ProgressSchema);

export type UnshieldedUpdate = Schema.Schema.Type<typeof UnshieldedUpdateSchema>;

const UnshieldedUpdateDecoder = Schema.decodeUnknown(UnshieldedUpdateSchema);

export class SyncServiceError extends Data.TaggedError('SyncServiceError')<{ readonly error?: unknown }> {}

export interface SyncServiceLive {
  readonly startSync: (
    address: string,
    transactionId: number,
  ) => Stream.Stream<UnshieldedUpdate, SyncServiceError, Scope.Scope>;
}

export class SyncService extends Context.Tag('@midnight-ntwrk/wallet-sdk-unshielded-wallet/SyncService')<
  SyncService,
  SyncServiceLive
>() {
  static readonly LiveWithIndexer = (indexerUrl: string): Layer.Layer<SyncService> => {
    const make = Effect.gen(function* () {
      const indexerClient = yield* UnshieldedTransactions;

      const startSync = (address: string, transactionId: number) =>
        pipe(
          indexerClient({ address, transactionId }),
          Stream.provideLayer(WsSubscriptionClient.layer({ url: indexerUrl })),
          Stream.mapEffect((message) => {
            const { type } = message.unshieldedTransactions;

            if (type === 'UnshieldedTransactionsProgress') {
              return UnshieldedUpdateDecoder({
                type,
                highestTransactionId: message.unshieldedTransactions.highestTransactionId,
              });
            } else {
              const { transaction, createdUtxos, spentUtxos } = message.unshieldedTransactions;

              return UnshieldedUpdateDecoder({
                type,
                transaction: {
                  id: transaction.id,
                  hash: transaction.hash,
                  identifiers: transaction.identifiers,
                  protocolVersion: transaction.protocolVersion,
                  transactionResult: transaction.transactionResult,
                  createdUtxos: createdUtxos.map((utxo) => ({
                    value: utxo.value,
                    owner: utxo.owner,
                    type: utxo.tokenType,
                    intentHash: utxo.intentHash,
                    outputNo: utxo.outputIndex,
                  })),
                  spentUtxos: spentUtxos.map((utxo) => ({
                    value: utxo.value,
                    owner: utxo.owner,
                    type: utxo.tokenType,
                    intentHash: utxo.intentHash,
                    outputNo: utxo.outputIndex,
                  })),
                },
              });
            }
          }),
          Stream.mapError((error) => new SyncServiceError({ error })),
        );

      return SyncService.of({ startSync });
    });

    return Layer.effect(SyncService, make);
  };
}
