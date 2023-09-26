import { Transaction } from '@midnight/zswap';
import { Wallet } from '@midnight/wallet-api';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Resource {
  start(): void;

  close(): Promise<void>;
}

export declare class WalletBuilder {

  /**
   * Create an instance of wallet
   * @param indexerUri PubSub-Indexer HTTP URI
   * @param indexerWsUri PubSub-Indexer Websockets URI
   * @param proverServerUri Prover server URI
   * @param substrateNodeUri Node URI
   * @param initialState Initial ZSwapLocalState serialized as Base64.
   * A new random initial state will be generated if this is `undefined`
   * @param minLogLevel Only statements with this level and above will be logged
   */
  static build(
    indexerUri: string,
    indexerWsUri: string,
    proverServerUri: string,
    substrateNodeUri: string,
    initialState?: string,
    minLogLevel?: LogLevel,
  ): Promise<Wallet & Resource>;

  /**
   * Build a wallet from a BIP32 compatible seed phrase
   * @param indexerUri PubSub-Indexer HTTP URI
   * @param indexerWsUri PubSub-Indexer Websockets URI
   * @param proverServerUri Prover server URI
   * @param substrateNodeUri Node URI
   * @param seed A BIP32 compatible mnemonic seed phrase hex encoded
   * @param minLogLevel Only statements with this level and above will be logged
   */
  static buildFromSeed(
    indexerUri: string,
    indexerWsUri: string,
    proverServerUri: string,
    substrateNodeUri: string,
    seed: string,
    minLogLevel?: LogLevel,
  ): Promise<Wallet & Resource>;

  static calculateCost(tx: Transaction): bigint;

  static generateInitialState(): string;
}
