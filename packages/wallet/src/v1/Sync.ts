import { ShieldedEncryptionSecretKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger';
import { Effect, Layer, ParseResult, Scope, Stream, Schema, pipe, Either } from 'effect';
import { CoreWallet } from './CoreWallet';
import { Simulator, SimulatorState } from './Simulator';
import { Connect, ShieldedTransactions } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
  QueryClient,
  SubscriptionClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, WalletError } from './WalletError';
import { FinalizedTransaction } from './Transaction';
import { HttpURL, InvalidProtocolSchemeError, URLError, WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { TransactionHistoryCapability } from './TransactionHistory';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
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
  networkId: ledger.NetworkId;
};

export type DefaultSyncContext = {
  transactionHistoryCapability: TransactionHistoryCapability<CoreWallet, FinalizedTransaction>;
};

export const TransactionResult = Schema.Struct({
  status: Schema.Union(Schema.Literal('SUCCESS'), Schema.Literal('PARTIAL_SUCCESS'), Schema.Literal('FAILURE')),
  segments: Schema.Union(
    Schema.Null,
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        success: Schema.Boolean,
      }),
    ),
  ),
});

export type TransactionResult = Schema.Schema.Type<typeof TransactionResult>;

export const WalletTransactionResult = Schema.Struct({
  status: Schema.Union(Schema.Literal('success'), Schema.Literal('partialSuccess'), Schema.Literal('failure')),
  segments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      success: Schema.Boolean,
    }),
  ),
});

export type WalletTransactionResult = Schema.Schema.Type<typeof WalletTransactionResult>;

const mapTxResult = (txResult: TransactionResult): WalletTransactionResult => {
  const segments = txResult.segments ?? [];
  switch (txResult.status) {
    case 'SUCCESS':
      return { status: 'success', segments };
    case 'FAILURE':
      return { status: 'failure', segments };
    case 'PARTIAL_SUCCESS':
      return { status: 'partialSuccess', segments };
  }
};

const TxSchema = Schema.declare(
  (input: unknown): input is FinalizedTransaction => input instanceof ledger.Transaction,
).annotations({
  identifier: 'ledger.Transaction',
});

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const TxFromUint8Array = (networkId: ledger.NetworkId): Schema.Schema<FinalizedTransaction, Uint8Array> =>
  Schema.transformOrFail(Uint8ArraySchema, TxSchema, {
    encode: (tx) => {
      return Effect.try({
        try: () => {
          return tx.serialize(networkId);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize transaction');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => {
          return ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes, networkId);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize transaction');
        },
      }),
  });

const HexedTx = (networkId: ledger.NetworkId): Schema.Schema<FinalizedTransaction, string> =>
  pipe(Schema.Uint8ArrayFromHex, Schema.compose(TxFromUint8Array(networkId)));

const MerkleTreeCollapsedUpdateSchema = Schema.declare(
  (input: unknown): input is ledger.MerkleTreeCollapsedUpdate => input instanceof ledger.MerkleTreeCollapsedUpdate,
).annotations({
  identifier: 'ledger.MerkleTreeCollapsedUpdate',
});

const MerkleTreeCollapsedUpdateFromUint8Array = (
  networkId: ledger.NetworkId,
): Schema.Schema<ledger.MerkleTreeCollapsedUpdate, Uint8Array> =>
  Schema.transformOrFail(Uint8ArraySchema, MerkleTreeCollapsedUpdateSchema, {
    encode: (mk) => {
      return Effect.try({
        try: () => {
          return mk.serialize(networkId);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize merkleTreeCollapsedUpdate');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => {
          return ledger.MerkleTreeCollapsedUpdate.deserialize(bytes, networkId);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize merkleTreeCollapsedUpdate');
        },
      }),
  });

const HexedMerkleTree = (networkId: ledger.NetworkId): Schema.Schema<ledger.MerkleTreeCollapsedUpdate, string> =>
  pipe(Schema.Uint8ArrayFromHex, Schema.compose(MerkleTreeCollapsedUpdateFromUint8Array(networkId)));

const ProgressUpdate = Schema.Struct({
  __typename: Schema.Literal('ShieldedTransactionsProgress'),
  highestIndex: Schema.Number,
  highestRelevantIndex: Schema.Number,
  highestRelevantWalletIndex: Schema.Number,
});

type ProgressUpdate = Schema.Schema.Type<typeof ProgressUpdate>;

const ViewingUpdateSchema = (networkId: ledger.NetworkId) =>
  Schema.Struct({
    __typename: Schema.Literal('ViewingUpdate'),
    index: Schema.Number,
    update: Schema.Array(
      Schema.Union(
        Schema.Struct({
          update: HexedMerkleTree(networkId),
          protocolVersion: Schema.Number,
        }),
        Schema.Struct({
          transaction: Schema.Struct({
            hash: Schema.String,
            raw: HexedTx(networkId),
            protocolVersion: Schema.Number,
            transactionResult: TransactionResult,
          }),
        }),
      ),
    ),
  });

export const SyncProgressUpdate = Schema.TaggedStruct('ProgressUpdate', {
  highestIndex: Schema.Number,
  highestRelevantIndex: Schema.Number,
  highestRelevantWalletIndex: Schema.Number,
});

type SyncProgressUpdate = Schema.Schema.Type<typeof SyncProgressUpdate>;

export const SyncProgressUpdateFromProgressUpdate = Schema.transformOrFail(ProgressUpdate, SyncProgressUpdate, {
  decode: (input) => {
    return Effect.try({
      try: () => {
        const { __typename, ..._rest } = input;
        return {
          _tag: 'ProgressUpdate' as const,
          highestIndex: input.highestIndex,
          highestRelevantIndex: input.highestRelevantIndex,
          highestRelevantWalletIndex: input.highestRelevantWalletIndex,
        };
      },
      catch: (error) => new ParseResult.Unexpected(error, 'Failed to decode progress update'),
    });
  },
  encode: (output) => {
    return Effect.try({
      try: () => {
        const { _tag, ..._rest } = output;
        return {
          __typename: 'ShieldedTransactionsProgress' as const,
          highestIndex: output.highestIndex,
          highestRelevantIndex: output.highestRelevantIndex,
          highestRelevantWalletIndex: output.highestRelevantWalletIndex,
        };
      },
      catch: (error) => new ParseResult.Unexpected(error, 'Failed to encode progress update'),
    });
  },
});

export const SyncViewingUpdateWithMerkleTreeUpdate = Schema.TaggedStruct('ViewingUpdateWithMerkleTreeUpdate', {
  index: Schema.Number,
  update: MerkleTreeCollapsedUpdateSchema,
  protocolVersion: Schema.Number,
});

type SyncViewingUpdateWithMerkleTreeUpdate = Schema.Schema.Type<typeof SyncViewingUpdateWithMerkleTreeUpdate>;

export const SyncViewingUpdateWithTransaction = Schema.TaggedStruct('ViewingUpdateWithTransaction', {
  index: Schema.Number,
  appliedTransaction: Schema.Struct({
    tx: TxSchema,
    transactionResult: WalletTransactionResult,
  }),
  protocolVersion: Schema.Number,
});

type SyncViewingUpdateWithTransaction = Schema.Schema.Type<typeof SyncViewingUpdateWithTransaction>;

const SyncViewingUpdateUnion = Schema.Union(SyncViewingUpdateWithMerkleTreeUpdate, SyncViewingUpdateWithTransaction);

const SyncViewingUpdateFromViewingUpdate = (networkId: ledger.NetworkId) =>
  Schema.asSchema(
    Schema.transformOrFail(ViewingUpdateSchema(networkId), SyncViewingUpdateUnion, {
      decode: (input) => {
        return Effect.try({
          try: () => {
            const { __typename, index, update } = input;
            if ('update' in update[0]) {
              return {
                _tag: 'ViewingUpdateWithMerkleTreeUpdate' as const,
                index,
                update: update[0].update,
                protocolVersion: update[0].protocolVersion,
              };
            } else {
              const mappedTxResult = mapTxResult(update[0].transaction.transactionResult);

              return {
                _tag: 'ViewingUpdateWithTransaction' as const,
                index,
                appliedTransaction: {
                  tx: update[0].transaction.raw,
                  transactionResult: mappedTxResult,
                },
                protocolVersion: update[0].transaction.protocolVersion,
              };
            }
          },
          catch: (error) => new ParseResult.Unexpected(error, 'Failed to decode viewing update'),
        });
      },
      encode: (output) => {
        if (output._tag === 'ViewingUpdateWithMerkleTreeUpdate') {
          return Effect.try({
            try: () => {
              return {
                __typename: 'ViewingUpdate' as const,
                index: output.index,
                update: [
                  {
                    update: output.update,
                    protocolVersion: output.protocolVersion,
                  },
                ],
              };
            },
            catch: (error) => new ParseResult.Unexpected(error, 'Failed to encode update type'),
          });
        } else {
          return Effect.try({
            try: () => {
              throw new Error('Transaction type cannot be encoded back');
            },
            catch: (error) => new ParseResult.Unexpected(error, 'not encodable'),
          });
        }
      },
    }),
  );

const WalletSyncSubscription = (networkId: ledger.NetworkId) =>
  Schema.Union(SyncProgressUpdateFromProgressUpdate, SyncViewingUpdateFromViewingUpdate(networkId));

export type WalletSyncSubscription = Schema.Schema.Type<ReturnType<typeof WalletSyncSubscription>>;

type SecretKeysResource = <A>(cb: (keys: ledger.ZswapSecretKeys) => A) => A;
export const SecretKeysResource = {
  create: (secretKeys: ledger.ZswapSecretKeys): SecretKeysResource => {
    /**
     * TODO: future Ledger version will include `clear` function to clear the secret keys,
     * it is intentend to be used here instead of `null`
     */
    let sk: ledger.ZswapSecretKeys | null = secretKeys;
    return (cb) => {
      if (sk === null) {
        throw new Error('Secret keys have been consumed');
      }
      const result = cb(sk);
      sk = null;
      return result;
    };
  },
};

export type WalletSyncUpdate = {
  update: WalletSyncSubscription;
  secretKeys: SecretKeysResource;
};
export const WalletSyncUpdate = {
  create: (update: WalletSyncSubscription, secretKeys: ledger.ZswapSecretKeys): WalletSyncUpdate => {
    return {
      update,
      secretKeys: SecretKeysResource.create(secretKeys),
    };
  },
};

export const makeDefaultSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<CoreWallet, ledger.ZswapSecretKeys, WalletSyncUpdate> => {
  const indexerSyncService = makeIndexerSyncService(config);
  return {
    updates: (
      state: CoreWallet,
      secretKeys: ledger.ZswapSecretKeys,
    ): Stream.Stream<WalletSyncUpdate, WalletError, Scope.Scope> => {
      return Stream.fromEffect(indexerSyncService.connectWallet(secretKeys)).pipe(
        Stream.flatMap((session) => indexerSyncService.subscribeWallet(state, session, config.networkId)),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKeys)),
        Stream.provideSomeLayer(indexerSyncService.connectionLayer()),
      );
    },
  };
};

export type IndexerSyncService = {
  connectionLayer: () => Layer.Layer<QueryClient | SubscriptionClient, WalletError, Scope.Scope>;
  connectWallet: (secretKeys: ledger.ZswapSecretKeys) => Effect.Effect<string, WalletError, QueryClient>;
  subscribeWallet: (
    state: CoreWallet,
    connectionId: string,
    networkId: ledger.NetworkId,
  ) => Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient>;
};

export const makeIndexerSyncService = (config: DefaultSyncConfiguration): IndexerSyncService => {
  return {
    connectionLayer(): Layer.Layer<QueryClient | SubscriptionClient, WalletError, Scope.Scope> {
      const { indexerClientConnection } = config;

      const indexerHttpLayer: Layer.Layer<QueryClient, WalletError, Scope.Scope> = HttpURL.make(
        indexerClientConnection.indexerHttpUrl,
      ).pipe(
        Either.match({
          onLeft: (error: InvalidProtocolSchemeError) => Layer.fail(error),
          onRight: (url: HttpURL.HttpUrl) => HttpQueryClient.layer({ url }),
        }),
        Layer.mapError((e) => new SyncWalletError({ message: 'Invalid indexer HTTP URL', cause: e })),
      );

      const indexerWsLayer: Layer.Layer<SubscriptionClient, WalletError, Scope.Scope> =
        ConnectionHelper.createWebSocketUrl(
          indexerClientConnection.indexerHttpUrl,
          indexerClientConnection.indexerWsUrl,
        ).pipe(
          Either.flatMap((url) => WsURL.make(url)),
          Either.match({
            onLeft: (error) => Layer.fail(error),
            onRight: (url: WsURL.WsURL) => WsSubscriptionClient.layer({ url }),
          }),
          Layer.mapError(
            (e: URLError) => new SyncWalletError({ message: 'Failed to to obtain correct indexer URLs', cause: e }),
          ),
        );

      return Layer.mergeAll(indexerHttpLayer, indexerWsLayer);
    },
    connectWallet(secretKeys: ledger.ZswapSecretKeys): Effect.Effect<string, WalletError, QueryClient> {
      return Effect.try({
        try: () => {
          const encryptionSecretKey = new ShieldedEncryptionSecretKey(secretKeys.encryptionSecretKey);

          return ShieldedEncryptionSecretKey.codec.encode(config.networkId, encryptionSecretKey).asString();
        },
        catch: (error) => new SyncWalletError({ message: 'Failed to connect wallet to indexer', cause: error }),
      }).pipe(
        Effect.flatMap((bech32mESK) => Connect.run({ viewingKey: bech32mESK })),
        Effect.map((session) => session.connect),
        Effect.mapError(
          (error) => new SyncWalletError({ message: 'Failed to connect wallet to indexer', cause: error }),
        ),
      );
    },
    subscribeWallet(
      state: CoreWallet,
      connectionId: string,
      networkId: ledger.NetworkId,
    ): Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;

      return ShieldedTransactions.run({
        sessionId: connectionId,
        index: Number(appliedIndex),
        sendProgressUpdates: true,
      }).pipe(
        Stream.mapError((error) => {
          return new SyncWalletError(error);
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(WalletSyncSubscription(networkId))(subscription.shieldedTransactions),
            Either.mapLeft((err) => new SyncWalletError(new Error(`Schema decode failed: ${err.message}`))),
            EitherOps.toEffect,
          ),
        ),
        Stream.mapAccum({ isFirstProgressUpdate: true }, (acc, update: WalletSyncSubscription) => {
          if (acc.isFirstProgressUpdate && update._tag === 'ProgressUpdate') {
            return [{ isFirstProgressUpdate: false }, null];
          }

          return [{ isFirstProgressUpdate: false }, update];
        }),
        Stream.filter((update): update is WalletSyncSubscription => update !== null),
      );
    },
  };
};

export const makeDefaultSyncCapability = (
  config: DefaultSyncConfiguration,
  getContext: () => DefaultSyncContext,
): SyncCapability<CoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate(state: CoreWallet, wrappedUpdate: WalletSyncUpdate): CoreWallet {
      const { update, secretKeys } = wrappedUpdate;
      switch (update._tag) {
        case 'ProgressUpdate':
          return state.updateProgress({
            highestRelevantWalletIndex: BigInt(update.highestRelevantWalletIndex),
            highestIndex: BigInt(update.highestIndex),
            highestRelevantIndex: BigInt(update.highestRelevantIndex),
            isConnected: true,
          });

        case 'ViewingUpdateWithMerkleTreeUpdate': {
          const appliedIndex = BigInt(update.index - 1);
          return state.applyCollapsedUpdate(update.update).updateProgress({ appliedIndex });
        }

        case 'ViewingUpdateWithTransaction': {
          const offset = BigInt(update.index);

          const { transactionResult } = update.appliedTransaction;

          const appliedIndex = transactionResult.status === 'failure' ? offset : offset - 1n;

          let mappedTxResult: ledger.TransactionResult = {
            type: transactionResult.status,
          };

          if (transactionResult.status === 'partialSuccess') {
            mappedTxResult = {
              type: 'partialSuccess',
              successfulSegments: new Map(transactionResult.segments.map((s) => [Number(s.id), s.success])),
            };
          }

          const wallet = secretKeys((keys) => {
            return state
              .applyTransaction(keys, update.appliedTransaction.tx, mappedTxResult)
              .updateProgress({ appliedIndex });
          });

          const transactionHistoryCapability = getContext().transactionHistoryCapability;

          return transactionHistoryCapability.updateTxHistory(wallet, [update.appliedTransaction.tx]);
        }
      }
    },
  };
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
  networkId: ledger.NetworkId;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
  secretKeys: ledger.ZswapSecretKeys;
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, ledger.ZswapSecretKeys, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet, secretKeys: ledger.ZswapSecretKeys) =>
      config.simulator.state$.pipe(Stream.map((state) => ({ update: state, secretKeys: secretKeys }))),
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate) => {
      return state.applyTransaction(update.secretKeys, update.update.lastTx, update.update.lastTxResult);
    },
  };
};

export type TxApplierSyncUpdate = {
  tx: FinalizedTransaction;
  secretKeys: ledger.ZswapSecretKeys;
};
/**
 * Skeleton of a "full-node" sync capability.
 * It is how the simulator one could look like (differenes are tiny) and how syncing tx by tx should look like
 */
export const makeTxApplierSyncCapability = (): SyncCapability<CoreWallet, TxApplierSyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, update: TxApplierSyncUpdate) => {
      return state.applyTransaction(update.secretKeys, update.tx, { type: 'success' });
    },
  };
};
