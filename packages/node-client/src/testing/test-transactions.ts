import { Effect, ParseResult, pipe, Schema, Stream } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger';
import path from 'node:path';
import { FileSystem, Error } from '@effect/platform';

const paths = new (class {
  currentDir = path.dirname(new URL(import.meta.url).pathname);
  packageDir = path.resolve(this.currentDir, '..', '..');
  testTxs = path.resolve(this.packageDir, 'resources/test-txs.json');
})();

const TxSchema = Schema.declare(
  (input: unknown): input is ledger.Transaction => input instanceof ledger.Transaction,
).annotations({
  identifier: 'ledger.Transaction',
});
const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});
const TxFromUint8Array: Schema.Schema<ledger.Transaction, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, TxSchema, {
    encode: (tx) => Effect.sync(() => tx.serialize(ledger.NetworkId.Undeployed)),
    decode: (bytes) =>
      Effect.try({
        try: () => ledger.Transaction.deserialize(bytes, ledger.NetworkId.Undeployed),
        catch: (err) => new ParseResult.Unexpected(err, 'Could not deserialize transaction'),
      }),
  }),
);

const HexedTx: Schema.Schema<ledger.Transaction, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(TxFromUint8Array),
);
type TxSchema = Schema.Schema.Type<typeof HexedTx>;

const TestTransactionsSchema = Schema.Struct({
  initial_tx: HexedTx,
  unbalanced_tx: HexedTx,
  batches: Schema.Array(
    Schema.Struct({
      txs: Schema.Array(HexedTx),
    }),
  ),
});
export type TestTransactions = Schema.Schema.Type<typeof TestTransactionsSchema>;

export const load: Effect.Effect<
  TestTransactions,
  ParseResult.ParseError | Error.PlatformError,
  FileSystem.FileSystem
> = pipe(
  FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.readFileString(paths.testTxs))),
  Effect.map((str) => JSON.parse(str) as unknown),
  Effect.andThen(Schema.decodeUnknown(TestTransactionsSchema, { errors: 'all' })),
  Effect.cached,
  Effect.flatten,
);

export const streamAllValid = (txs: TestTransactions): Stream.Stream<ledger.Transaction> => {
  const initial = Stream.succeed(txs.initial_tx);
  const batches = Stream.fromIterable(txs.batches).pipe(Stream.flatMap((batch) => Stream.fromIterable(batch.txs)));

  return Stream.concat(initial, batches);
};
