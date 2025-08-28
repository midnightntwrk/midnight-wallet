import { ShieldedEncryptionSecretKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { JsOption } from '@midnight-ntwrk/wallet';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Layer, ParseResult, Scope, Stream, Schema, pipe, Either, Option } from 'effect';
import { V1State } from './RunningV1Variant';
import { Simulator, SimulatorState } from './Simulator';
import { Connect, Wallet } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, WalletError } from './WalletError';
import { KeysCapability } from './Keys';
import { fromScala } from '../effect/OptionOps';
import { HttpURL, WsURL } from '@midnight-ntwrk/abstractions';
import { TransactionHistoryCapability } from './TransactionHistory';
import { EitherOps } from '../effect';

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
  networkId: zswap.NetworkId;
};

export type DefaultSyncContext = {
  keysCapability: KeysCapability<V1State>;
  transactionHistoryCapability: TransactionHistoryCapability<V1State, zswap.Transaction>;
};

export const IndexerApplyStage = Schema.Union(
  Schema.Literal('SucceedEntirely'),
  Schema.Literal('FailEntirely'),
  Schema.Literal('FailFallible'),
);

type IndexerApplyStage = Schema.Schema.Type<typeof IndexerApplyStage>;

export const WalletApplyState = Schema.Union(
  Schema.Literal('success'),
  Schema.Literal('partialSuccess'),
  Schema.Literal('failure'),
);

type WalletApplyState = Schema.Schema.Type<typeof WalletApplyState>;

const mapApplyStage = (applyStage: IndexerApplyStage): WalletApplyState => {
  switch (applyStage) {
    case 'SucceedEntirely':
      return 'success';
    case 'FailEntirely':
      return 'failure';
    case 'FailFallible':
      return 'partialSuccess';
  }
};

const TxSchema = Schema.declare(
  (input: unknown): input is zswap.Transaction => input instanceof zswap.Transaction,
).annotations({
  identifier: 'zswap.Transaction',
});

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const TxFromUint8Array: Schema.Schema<zswap.Transaction, Uint8Array> = Schema.transformOrFail(
  Uint8ArraySchema,
  TxSchema,
  {
    encode: (tx) => {
      return Effect.try({
        try: () => {
          return tx.serialize(zswap.NetworkId.Undeployed);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize transaction');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => {
          return zswap.Transaction.deserialize(bytes, zswap.NetworkId.Undeployed);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize transaction');
        },
      }),
  },
);

const HexedTx: Schema.Schema<zswap.Transaction, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(TxFromUint8Array),
);

const MerkleTreeCollapsedUpdateSchema = Schema.declare(
  (input: unknown): input is zswap.MerkleTreeCollapsedUpdate => input instanceof zswap.MerkleTreeCollapsedUpdate,
).annotations({
  identifier: 'zswap.MerkleTreeCollapsedUpdate',
});

const MerkleTreeCollapsedUpdateFromUint8Array: Schema.Schema<zswap.MerkleTreeCollapsedUpdate, Uint8Array> =
  Schema.transformOrFail(Uint8ArraySchema, MerkleTreeCollapsedUpdateSchema, {
    encode: (mk) => {
      return Effect.try({
        try: () => {
          return mk.serialize(zswap.NetworkId.Undeployed);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize merkleTreeCollapsedUpdate');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => {
          return zswap.MerkleTreeCollapsedUpdate.deserialize(bytes, zswap.NetworkId.Undeployed);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize merkleTreeCollapsedUpdate');
        },
      }),
  });

const HexedMerkleTree: Schema.Schema<zswap.MerkleTreeCollapsedUpdate, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(MerkleTreeCollapsedUpdateFromUint8Array),
);

const ProgressUpdate = Schema.Struct({
  __typename: Schema.Literal('ProgressUpdate'),
  highestIndex: Schema.Number,
  highestRelevantIndex: Schema.Number,
  highestRelevantWalletIndex: Schema.Number,
});

type ProgressUpdate = Schema.Schema.Type<typeof ProgressUpdate>;

const ViewingUpdateSchema = Schema.Struct({
  __typename: Schema.Literal('ViewingUpdate'),
  index: Schema.Number,
  update: Schema.Array(
    Schema.Union(
      Schema.Struct({
        update: HexedMerkleTree,
        protocolVersion: Schema.Number,
      }),
      Schema.Struct({
        transaction: Schema.Struct({
          hash: Schema.String,
          raw: HexedTx,
          applyStage: IndexerApplyStage,
          protocolVersion: Schema.Number,
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
          __typename: 'ProgressUpdate' as const,
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
    applyState: WalletApplyState,
  }),
  protocolVersion: Schema.Number,
});

type SyncViewingUpdateWithTransaction = Schema.Schema.Type<typeof SyncViewingUpdateWithTransaction>;

const SyncViewingUpdateUnion = Schema.Union(SyncViewingUpdateWithMerkleTreeUpdate, SyncViewingUpdateWithTransaction);

export const SyncViewingUpdateFromViewingUpdate = Schema.transformOrFail(ViewingUpdateSchema, SyncViewingUpdateUnion, {
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
          const mappedApplyStage = mapApplyStage(update[0].transaction.applyStage);
          return {
            _tag: 'ViewingUpdateWithTransaction' as const,
            index,
            appliedTransaction: {
              tx: update[0].transaction.raw,
              applyState: mappedApplyStage,
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
});

const WalletSyncSubscription = Schema.Union(SyncProgressUpdateFromProgressUpdate, SyncViewingUpdateFromViewingUpdate);

export type WalletSyncSubscription = Schema.Schema.Type<typeof WalletSyncSubscription>;

export const makeDefaultSyncService = (
  config: DefaultSyncConfiguration,
  getContext: () => DefaultSyncContext,
): SyncService<V1State, WalletSyncSubscription> => {
  return {
    updates: (state: V1State): Stream.Stream<WalletSyncSubscription, WalletError, Scope.Scope> => {
      const { indexerClientConnection, networkId } = config;

      const indexerHttpUrlResult = HttpURL.make(indexerClientConnection.indexerHttpUrl);
      if (Either.isLeft(indexerHttpUrlResult)) {
        return Stream.fail(
          new SyncWalletError(new Error(`Invalid indexer HTTP URL: ${indexerHttpUrlResult.left.message}`)),
        );
      }
      const indexerHttpUrl = indexerHttpUrlResult.right;

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

      const keysCapability = getContext().keysCapability;
      const appliedIndex = fromScala(state.progress.appliedIndex).pipe(
        Option.map((offset) => Number(offset.value)),
        Option.getOrNull,
      );
      const encryptionSecretKey = keysCapability.getEncryptionSecretKey(state);

      const bech32mESK = ShieldedEncryptionSecretKey.codec.encode(networkId, encryptionSecretKey).asString();

      return pipe(
        Connect.run({ viewingKey: bech32mESK }),
        Stream.flatMap((session) => {
          return Wallet.run({ sessionId: session.connect, index: appliedIndex });
        }),
        Stream.provideSomeLayer(
          Layer.mergeAll(
            HttpQueryClient.layer({ url: indexerHttpUrl }),
            WsSubscriptionClient.layer({ url: indexerWsUrl }),
          ),
        ),
        Stream.mapError((error) => {
          return new SyncWalletError(error);
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(WalletSyncSubscription)(subscription.wallet),
            Either.mapLeft((err) => new SyncWalletError(new Error(`Schema decode failed: ${err.message}`))),
            EitherOps.toEffect,
          ),
        ),
      );
    },
  };
};

export const makeDefaultSyncCapability = (
  config: DefaultSyncConfiguration,
  getContext: () => DefaultSyncContext,
): SyncCapability<V1State, WalletSyncSubscription> => {
  return {
    applyUpdate(state: V1State, update: WalletSyncSubscription): V1State {
      switch (update._tag) {
        case 'ProgressUpdate':
          return state.updateProgress(
            JsOption.asResult(state.progress.appliedIndex)?.value,
            BigInt(update.highestRelevantWalletIndex),
            BigInt(update.highestIndex),
            BigInt(update.highestRelevantIndex),
          );

        case 'ViewingUpdateWithMerkleTreeUpdate': {
          const newLocalState = state.state.applyCollapsedUpdate(update.update);
          return state.applyState(newLocalState);
        }

        case 'ViewingUpdateWithTransaction': {
          const newLocalState = state.state.applyTx(
            state.secretKeys,
            update.appliedTransaction.tx,
            update.appliedTransaction.applyState,
          );

          let updatedState = state.applyState(newLocalState);

          const offset = BigInt(update.index);
          const appliedIndex = update.appliedTransaction.applyState === 'failure' ? offset : offset - 1n;

          updatedState = updatedState.update(appliedIndex, offset, BigInt(update.protocolVersion), true);

          const transactionHistoryCapability = getContext().transactionHistoryCapability;

          updatedState = transactionHistoryCapability.updateTxHistory(updatedState, [update.appliedTransaction.tx]);

          return updatedState;
        }
      }
    },
  };
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
  networkId: zswap.NetworkId;
};

export const makeSimulatorSyncService = (config: SimulatorSyncConfiguration): SyncService<V1State, SimulatorState> => {
  return {
    updates: () => config.simulator.state$,
  };
};

export const makeSimulatorSyncCapability = (
  config: SimulatorSyncConfiguration,
): SyncCapability<V1State, SimulatorState> => {
  return {
    applyUpdate: (state: V1State, update: SimulatorState) => {
      const newLocalState = state.state.applyProofErasedTx(
        state.secretKeys,
        zswap.ProofErasedTransaction.deserialize(update.lastTx.serialize(config.networkId), config.networkId),
        update.lastTxResult.type,
      );
      return state.applyState(newLocalState);
    },
  };
};

export const makeTxApplierSyncCapability = (): SyncCapability<V1State, zswap.Transaction> => {
  return {
    applyUpdate: (state: V1State, update: zswap.Transaction) => {
      const newLocalState = state.state.applyTx(state.secretKeys, update, 'success');
      return state.applyState(newLocalState);
    },
  };
};
