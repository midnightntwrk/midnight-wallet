import { Schema } from 'effect';

const TransactionHashSchema = Schema.String;

export type TransactionHash = Schema.Schema.Type<typeof TransactionHashSchema>;

export const TransactionHistoryEntrySchema = Schema.Struct({
  id: Schema.Number,
  hash: TransactionHashSchema,
  protocolVersion: Schema.Number,
  identifiers: Schema.Array(Schema.String),
  transactionResult: Schema.NullOr(
    Schema.Struct({
      status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
      segments: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          success: Schema.Boolean,
        }),
      ),
    }),
  ),
});

export type TransactionHistoryEntry = Schema.Schema.Type<typeof TransactionHistoryEntrySchema>;

export interface TransactionHistoryStorage {
  create(entry: TransactionHistoryEntry): Promise<void>;
  delete(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<TransactionHistoryEntry>;
  get(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
}
