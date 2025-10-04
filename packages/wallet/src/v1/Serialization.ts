import { Effect, ParseResult, Either, pipe, Schema } from 'effect';
import { WalletError } from './WalletError';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { CoreWallet } from './CoreWallet';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError>;
};

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
};

const TxSchema = Schema.declare(
  (input: unknown): input is ledger.FinalizedTransaction => input instanceof ledger.Transaction,
).annotations({
  identifier: 'ledger.Transaction',
});

const StateSchema = Schema.declare(
  (input: unknown): input is ledger.ZswapLocalState => input instanceof ledger.ZswapLocalState,
).annotations({
  identifier: 'ledger.ZswapLocalState',
});

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const TxFromUint8Array = (): Schema.Schema<ledger.FinalizedTransaction, Uint8Array> =>
  Schema.asSchema(
    Schema.transformOrFail(Uint8ArraySchema, TxSchema, {
      encode: (tx) => {
        return Effect.try({
          try: () => {
            return tx.serialize();
          },
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not serialize transaction');
          },
        });
      },
      decode: (bytes) =>
        Effect.try({
          try: () => ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes),
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not deserialize transaction');
          },
        }),
    }),
  );

const StateFromUInt8Array = (): Schema.Schema<ledger.ZswapLocalState, Uint8Array> =>
  Schema.asSchema(
    Schema.transformOrFail(Uint8ArraySchema, StateSchema, {
      encode: (state) => {
        return Effect.try({
          try: () => {
            return state.serialize();
          },
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not serialize local state');
          },
        });
      },
      decode: (bytes) =>
        Effect.try({
          try: () => ledger.ZswapLocalState.deserialize(bytes),
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not deserialize local state');
          },
        }),
    }),
  );

const HexedTx = (): Schema.Schema<ledger.FinalizedTransaction, string> =>
  pipe(Schema.Uint8ArrayFromHex, Schema.compose(TxFromUint8Array()));

const HexedState = (): Schema.Schema<ledger.ZswapLocalState, string> =>
  pipe(Schema.Uint8ArrayFromHex, Schema.compose(StateFromUInt8Array()));

type TxSchema = Schema.Schema.Type<ReturnType<typeof HexedTx>>;

export const makeDefaultV1SerializationCapability = (): SerializationCapability<CoreWallet, null, string> => {
  const SnapshotSchema = Schema.Struct({
    publicKeys: Schema.Struct({
      coinPublicKey: Schema.String,
      encryptionPublicKey: Schema.String,
    }),
    txHistory: Schema.Array(HexedTx()),
    state: HexedState(),
    protocolVersion: Schema.BigInt,
    offset: Schema.optional(Schema.BigInt),
    networkId: Schema.String,
    coinHashes: Schema.Record({
      key: Schema.String,
      value: Schema.Struct({ nullifier: Schema.String, commitment: Schema.String }),
    }),
  });

  type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: CoreWallet): Snapshot => ({
        publicKeys: w.publicKeys,
        txHistory: w.txHistoryArray,
        state: w.state,
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        offset: w.progress?.appliedIndex,
        coinHashes: w.coinHashes,
      });

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (aux, serialized): Either.Either<CoreWallet, WalletError> => {
      return pipe(
        serialized,
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => WalletError.other(err)),
        Either.flatMap((snapshot: Snapshot) =>
          CoreWallet.restoreWithCoinHashes(
            snapshot.publicKeys,
            snapshot.state,
            snapshot.txHistory,
            snapshot.coinHashes,
            {
              appliedIndex: snapshot.offset ?? 0n,
              highestRelevantWalletIndex: 0n,
              highestIndex: 0n,
              highestRelevantIndex: 0n,
              isConnected: false,
            },
            snapshot.protocolVersion,
            snapshot.networkId,
          ),
        ),
      );
    },
  };
};
