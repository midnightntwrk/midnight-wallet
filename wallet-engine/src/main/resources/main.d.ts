import { Observable } from 'rxjs';
import { Transaction } from '@midnight/ledger';
import { FilterService, Wallet } from '@midnight/wallet-api';
import type { MockedNode, Transaction as NodeTransaction } from '@midnight/mocked-node-api';

export interface HasBalance {
  balance(): Observable<bigint>;
}

export interface Resource {
  start(): void;

  close(): Promise<void>;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export declare class WalletBuilder {
  static build(
    node: MockedNode<NodeTransaction>,
    initialState?: string,
    minLogLevel?: LogLevel,
  ): Promise<FilterService & Wallet & HasBalance & Resource>;

  static connect(
    nodeURI: string,
    initialState?: string,
    minLogLevel?: LogLevel
  ): Promise<FilterService & Wallet & HasBalance & Resource>;

  static calculateCost(tx: Transaction): bigint;

  static generateInitialState(): string;
}
