import { Observable } from 'rxjs';
import { Transaction } from '@midnight/ledger';
import { FilterService, Wallet } from '@midnight/wallet-api';
import type { MockedNode, Transaction as NodeTransaction, RequestNextResult, Block, TxSubmissionResult } from '@midnight/mocked-node-api';

export interface HasBalance {
  balance(): Observable<bigint>;
}

export interface Resource {
  start(): void;

  close(): Promise<void>;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface SyncSession {
    sync(): Observable<Block<NodeTransaction>>;
    close(): void;
}

export interface SubmitSession {
    submitTx(tx: NodeTransaction): Promise<TxSubmissionResult>;
    close(): void;
}

export interface NodeConnection {
    startSyncSession(): Promise<SyncSession>;
    startSubmitSession(): Promise<SubmitSession>;
}

export declare class WalletBuilder {
  static build(
    nodeConnection: NodeConnection,
    initialState?: string,
    minLogLevel?: LogLevel,
  ): Promise<FilterService & Wallet & HasBalance & Resource>;

  static calculateCost(tx: Transaction): bigint;

  static generateInitialState(): string;
}
