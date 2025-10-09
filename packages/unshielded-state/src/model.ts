import { Data, Effect, ParseResult, Schema, Stream } from 'effect';
import { ParseError } from 'effect/ParseResult';

export const BigIntSchema = Schema.declare((input: unknown): input is bigint => typeof input === 'bigint').annotations({
  identifier: 'BigIntSchema',
});

export const SafeBigInt: Schema.Schema<bigint, string> = Schema.transformOrFail(Schema.String, BigIntSchema, {
  decode: (value) =>
    Effect.try({
      try: () => BigInt(value),
      catch: (err) => new ParseResult.Unexpected(err, 'Could not parse bigint'),
    }),
  encode: (value) => Effect.succeed(value.toString()),
});

export const UtxoSchema = Schema.Data(
  Schema.Struct({
    value: SafeBigInt,
    owner: Schema.String,
    type: Schema.String,
    intentHash: Schema.String,
    outputNo: Schema.Number,
    registeredForDustGeneration: Schema.Boolean,
  }),
);

export type Utxo = Schema.Schema.Type<typeof UtxoSchema>;

export const SyncProgressSchema = Schema.Struct({
  highestTransactionId: Schema.Number,
  currentTransactionId: Schema.Number,
});

export type SyncProgress = Schema.Schema.Type<typeof SyncProgressSchema>;

export class UtxoNotFoundError extends Data.TaggedError('UtxoNotFoundError')<{
  readonly utxo: Utxo;
}> {}

export class RollbackError extends Data.TaggedError('RollbackError')<{
  readonly message?: string;
  readonly tx: UnshieldedTransaction;
}> {}

export class ApplyTransactionError extends Data.TaggedError('ApplyTransactionError')<{
  readonly message?: string;
  readonly tx: UnshieldedTransaction;
}> {}

export const UnshieldedTransactionSchema = Schema.Data(
  Schema.Struct({
    id: Schema.Number,
    hash: Schema.String,
    type: Schema.Literal('RegularTransaction', 'SystemTransaction'),
    protocolVersion: Schema.Number,
    identifiers: Schema.Array(Schema.String),
    transactionResult: Schema.NullOr(
      Schema.Struct({
        status: Schema.String, // TODO: change to literal
        segments: Schema.NullOr(
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              success: Schema.Boolean,
            }),
          ),
        ),
      }),
    ),
    createdUtxos: Schema.Array(UtxoSchema),
    spentUtxos: Schema.Array(UtxoSchema),
  }),
);

export type UnshieldedTransaction = Schema.Schema.Type<typeof UnshieldedTransactionSchema>;

export const UnshieldedStateSchema = Schema.Struct({
  utxos: Schema.HashSet(UtxoSchema),
  pendingUtxos: Schema.HashSet(UtxoSchema),
  syncProgress: Schema.UndefinedOr(SyncProgressSchema),
});

export const UnshieldedStateDecoder = Schema.decodeUnknownEither(UnshieldedStateSchema);

export const UnshieldedStateEncoder = Schema.encodeEither(UnshieldedStateSchema);

export type UnshieldedState = Schema.Schema.Type<typeof UnshieldedStateSchema>;

export interface UnshieldedStateAPI {
  state: Stream.Stream<UnshieldedState>;
  getLatestState: () => Effect.Effect<UnshieldedState>;
  applyTx: (tx: UnshieldedTransaction) => Effect.Effect<void, ParseError | ApplyTransactionError>;
  applyFailedTx: (tx: UnshieldedTransaction) => Effect.Effect<void, ParseError | ApplyTransactionError>;
  rollbackTx: (tx: UnshieldedTransaction) => Effect.Effect<void, ParseError | RollbackError>;
  spend: (utxoToSpend: Utxo) => Effect.Effect<void, ParseError | UtxoNotFoundError>;
  updateSyncProgress: (highestTransactionId: number) => Effect.Effect<void>;
}
