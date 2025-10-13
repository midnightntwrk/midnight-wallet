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

              return UnshieldedUpdateDecoder({
                type,
                transaction: {
                  type: transaction.type,
                  id: transaction.id,
                  hash: transaction.hash,
                  identifiers: isRegularTransaction ? transaction.identifiers : [],
                  protocolVersion: transaction.protocolVersion,
                  transactionResult,
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
