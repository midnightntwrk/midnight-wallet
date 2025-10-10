import { Effect, ParseResult, Either, pipe, Schema } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { DustCoreWallet } from './DustCoreWallet.js';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError.WalletError>;
};

const StateSchema = Schema.declare(
  (input: unknown): input is ledger.DustLocalState => input instanceof ledger.DustLocalState,
).annotations({
  identifier: 'ledger.DustLocalState',
});

export const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const StateFromUInt8Array: Schema.Schema<ledger.DustLocalState, Uint8Array> = Schema.asSchema(
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
        try: () => ledger.DustLocalState.deserialize(bytes),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize local state');
        },
      }),
  }),
);

const HexedState: Schema.Schema<ledger.DustLocalState, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(StateFromUInt8Array),
);

const SnapshotSchema = Schema.Struct({
  publicKey: Schema.Struct({
    publicKey: Schema.BigInt,
  }),
  state: HexedState,
  protocolVersion: Schema.BigInt,
  networkId: Schema.String,
  offset: Schema.optional(Schema.BigInt),
});

type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;

export const makeDefaultV1SerializationCapability = (): SerializationCapability<DustCoreWallet, null, string> => {
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: DustCoreWallet): Snapshot => ({
        publicKey: w.publicKey,
        state: w.state,
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        offset: w.progress?.appliedIndex,
      });

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (aux, serialized): Either.Either<DustCoreWallet, WalletError.WalletError> => {
      return pipe(
        serialized,
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => WalletError.WalletError.other(err)),
        Either.flatMap((snapshot: Snapshot) =>
          Either.try({
            try: () =>
              DustCoreWallet.restore(
                snapshot.state,
                snapshot.publicKey,
                [],
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
            catch: (err) => WalletError.WalletError.other(err),
          }),
        ),
      );
    },
  };
};
