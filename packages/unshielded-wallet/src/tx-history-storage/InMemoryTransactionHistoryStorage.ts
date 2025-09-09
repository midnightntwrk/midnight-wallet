import { Either, Schema } from 'effect';
import {
  TransactionHistoryStorage,
  TransactionHistoryEntrySchema,
  TransactionHistoryEntry,
  TransactionHash,
} from './TransactionHistoryStorage';

const TransactionHistorySchema = Schema.Map({
  key: Schema.String,
  value: TransactionHistoryEntrySchema,
});

export type TransactionHistory = Schema.Schema.Type<typeof TransactionHistorySchema>;

const TransactionHistoryEncoder = Schema.encodeSync(TransactionHistorySchema);
const TransactionHistoryDecoder = Schema.decodeUnknownEither(TransactionHistorySchema);

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 *
 * TODO: Implement update method with callback api when needed in the future
 */
export class InMemoryTransactionHistoryStorage implements TransactionHistoryStorage {
  private entries: TransactionHistory;

  constructor(entries?: TransactionHistory) {
    this.entries = entries || new Map<TransactionHash, TransactionHistoryEntry>();
  }

  create(entry: TransactionHistoryEntry): Promise<void> {
    this.entries.set(entry.hash, entry);
    return Promise.resolve();
  }

  delete(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> {
    const existingEntry = this.entries.get(hash);

    if (!existingEntry) {
      return Promise.resolve(undefined);
    }

    this.entries.delete(hash);

    return Promise.resolve(existingEntry);
  }

  async *getAll(): AsyncIterableIterator<TransactionHistoryEntry> {
    for (const entry of this.entries.values()) {
      yield await Promise.resolve(entry);
    }
  }

  get(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> {
    return Promise.resolve(this.entries.get(hash));
  }

  serialize(): string {
    const result = TransactionHistoryEncoder(this.entries);

    return JSON.stringify(result);
  }

  reset(): void {
    this.entries.clear();
  }

  static fromSerialized(serializedHistory: string): InMemoryTransactionHistoryStorage {
    const schema = JSON.parse(serializedHistory) as unknown;

    const decoded = Either.getOrElse(TransactionHistoryDecoder(schema), (error) => {
      throw new Error(`Failed to decode transaction history: ${error.message}`);
    });

    return new InMemoryTransactionHistoryStorage(decoded);
  }
}
