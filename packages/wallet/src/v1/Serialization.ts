import { Effect, ParseResult, Either, pipe, Schema } from 'effect';
import { V1State } from './RunningV1Variant';
import { WalletError } from './WalletError';
import * as ledger from '@midnight-ntwrk/ledger';
import { CoreWallet } from './CoreWallet';
import { FinalizedTransaction } from './types/ledger';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError>;
};

const TxSchema = Schema.declare(
  (input: unknown): input is FinalizedTransaction => input instanceof ledger.Transaction,
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

const TxFromUint8Array: Schema.Schema<FinalizedTransaction, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, TxSchema, {
    encode: (tx) => {
      return Effect.try({
        try: () => {
          return tx.serialize(ledger.NetworkId.Undeployed);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize transaction');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () =>
          ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes, ledger.NetworkId.Undeployed),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize transaction');
        },
      }),
  }),
);

const StateFromUInt8Array: Schema.Schema<ledger.ZswapLocalState, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, StateSchema, {
    encode: (state) => {
      return Effect.try({
        try: () => {
          return state.serialize(ledger.NetworkId.Undeployed);
        },
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize local state');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => ledger.ZswapLocalState.deserialize(bytes, ledger.NetworkId.Undeployed),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize local state');
        },
      }),
  }),
);

const HexedTx: Schema.Schema<FinalizedTransaction, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(TxFromUint8Array),
);

const HexedState: Schema.Schema<ledger.ZswapLocalState, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(StateFromUInt8Array),
);

type TxSchema = Schema.Schema.Type<typeof HexedTx>;

const SnapshotSchema = Schema.Struct({
  txHistory: Schema.Array(HexedTx),
  state: HexedState,
  protocolVersion: Schema.BigInt,
  offset: Schema.optional(Schema.BigInt),
  networkId: Schema.Enums(ledger.NetworkId),
});

type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;

export const makeDefaultV1SerializationCapability = (): SerializationCapability<
  V1State,
  ledger.ZswapSecretKeys,
  string
> => {
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: V1State): Snapshot => ({
        txHistory: w.txHistoryArray,
        state: w.state,
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        offset: w.progress?.appliedIndex,
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
                snapshot.state,
                aux,
                snapshot.txHistory,
                {
                  appliedIndex: snapshot.offset ?? 0n,
                  highestRelevantWalletIndex: 0n,
                  highestIndex: 0n,
                  highestRelevantIndex: 0n,
                },
                snapshot.protocolVersion,
                snapshot.networkId,
              ),
            catch: (err) => WalletError.other(err),
          }),
        ),
      );
    },
  };
};
