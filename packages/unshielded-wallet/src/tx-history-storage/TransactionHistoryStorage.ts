import { TransactionHash, UnshieldedTransactionHistoryEntry } from '@midnight-ntwrk/wallet-api';

export interface TransactionHistoryStorage {
  create(entry: UnshieldedTransactionHistoryEntry): Promise<void>;
  delete(hash: TransactionHash): Promise<UnshieldedTransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<UnshieldedTransactionHistoryEntry>;
  get(hash: TransactionHash): Promise<UnshieldedTransactionHistoryEntry | undefined>;
}
