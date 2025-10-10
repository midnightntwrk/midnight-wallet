import { TransactionHistoryStorage, TransactionHash, TransactionHistoryEntry } from './TransactionHistoryStorage.js';

export class NoOpTransactionHistoryStorage implements TransactionHistoryStorage {
  create(_entry: TransactionHistoryEntry): Promise<void> {
    return Promise.resolve();
  }

  delete(_hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> {
    return Promise.resolve(undefined);
  }

  async *getAll(): AsyncIterableIterator<TransactionHistoryEntry> {
    return Promise.resolve(yield* []);
  }

  get(_hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> {
    return Promise.resolve(undefined);
  }

  serialize(): string {
    return JSON.stringify({});
  }

  static deserialize(_serialized: string): NoOpTransactionHistoryStorage {
    return new NoOpTransactionHistoryStorage();
  }
}
