import { Effect, ParseResult, Either, pipe, Schema, Option } from 'effect';
import { V1State } from './RunningV1Variant';
import { WalletError } from './WalletError';
import * as zswap from '@midnight-ntwrk/zswap';
import { CoreWallet, NetworkId } from '@midnight-ntwrk/wallet';
import { OptionOps } from '../effect';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError>;
};

const TxSchema = Schema.declare(
  (input: unknown): input is zswap.Transaction => input instanceof zswap.Transaction,
).annotations({
  identifier: 'zswap.Transaction',
});

const StateSchema = Schema.declare(
  (input: unknown): input is zswap.LocalState => input instanceof zswap.LocalState,
).annotations({
  identifier: 'zswap.LocalState',
});

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const TxFromUint8Array: Schema.Schema<zswap.Transaction, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, TxSchema, {
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
        try: () => zswap.Transaction.deserialize(bytes, zswap.NetworkId.Undeployed),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize transaction');
        },
      }),
  }),
);

const StateFromUInt8Array: Schema.Schema<zswap.LocalState, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, StateSchema, {
    encode: (state) => {
      return Effect.try({
        try: () => {
          return state.serialize(zswap.NetworkId.Undeployed);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize local state');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => zswap.LocalState.deserialize(bytes, zswap.NetworkId.Undeployed),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize local state');
        },
      }),
  }),
);

const HexedTx: Schema.Schema<zswap.Transaction, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(TxFromUint8Array),
);

const HexedState: Schema.Schema<zswap.LocalState, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(StateFromUInt8Array),
);

type TxSchema = Schema.Schema.Type<typeof HexedTx>;

const SnapshotSchema = Schema.Struct({
  txHistory: Schema.Array(HexedTx),
  state: HexedState,
  protocolVersion: Schema.BigInt,
  offset: Schema.optional(Schema.BigInt),
  networkId: Schema.Enums(zswap.NetworkId),
});

type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;

export const makeDefaultV1SerializationCapability = (): SerializationCapability<V1State, zswap.SecretKeys, string> => {
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: V1State): Snapshot => ({
        txHistory: w.txHistoryArray,
        state: w.state,
        protocolVersion: w.protocolVersion.version,
        networkId: NetworkId.toJs(w.networkId),
        offset: OptionOps.fromScala(w.offset).pipe(
          Option.map((o) => o.value),
          Option.getOrUndefined,
        ),
      });

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (aux, serialized): Either.Either<V1State, WalletError> => {
      return pipe(
        serialized,
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => WalletError.other(err)),
        Either.flatMap((snapshot: Snapshot) =>
          Either.try({
            try: () =>
              CoreWallet.restore(
                aux,
                snapshot.state,
                snapshot.txHistory,
                snapshot.offset,
                snapshot.protocolVersion,
                NetworkId.fromJs(snapshot.networkId),
              ),
            catch: (err) => WalletError.other(err),
          }),
        ),
      );
    },
  };
};
