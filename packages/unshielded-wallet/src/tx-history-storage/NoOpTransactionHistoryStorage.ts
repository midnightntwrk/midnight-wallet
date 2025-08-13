import { TransactionHash, UnshieldedTransactionHistoryEntry } from '@midnight-ntwrk/wallet-api';
import { TransactionHistoryStorage } from './TransactionHistoryStorage';

export class NoOpTransactionHistoryStorage implements TransactionHistoryStorage {
  create(_entry: UnshieldedTransactionHistoryEntry): Promise<void> {
    return Promise.resolve();
  }

  delete(_hash: TransactionHash): Promise<UnshieldedTransactionHistoryEntry | undefined> {
    return Promise.resolve(undefined);
  }

  async *getAll(): AsyncIterableIterator<UnshieldedTransactionHistoryEntry> {
    return Promise.resolve(yield* []);
  }

  get(_hash: TransactionHash): Promise<UnshieldedTransactionHistoryEntry | undefined> {
    return Promise.resolve(undefined);
  }

  serialize(): string {
    return JSON.stringify({});
  }

  static deserialize(_serialized: string): NoOpTransactionHistoryStorage {
    return new NoOpTransactionHistoryStorage();
  }
}
