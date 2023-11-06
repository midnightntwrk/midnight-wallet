import { Transaction } from '@midnight-ntwrk/zswap';
import { Wallet } from '@midnight-ntwrk/wallet-api';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Resource {
  start(): void;

  close(): Promise<void>;
}

export declare class WalletBuilder {

  /**
   * Create an instance of a new wallet with a random seed
   * @param indexerUri PubSub-Indexer HTTP URI
   * @param indexerWsUri PubSub-Indexer Websockets URI
   * @param proverServerUri Prover server URI
   * @param substrateNodeUri Node URI
   * @param minLogLevel Only statements with this level and above will be logged
   */
  static build(
    indexerUri: string,
    indexerWsUri: string,
    proverServerUri: string,
    substrateNodeUri: string,
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

  /**
   * Create an instance of wallet
   * @param indexerUri PubSub-Indexer HTTP URI
   * @param indexerWsUri PubSub-Indexer Websockets URI
   * @param proverServerUri Prover server URI
   * @param substrateNodeUri Node URI
   * @param serializedState Serialized (JSON) state containing LocalState, Transaction History and Block Height
   * @param minLogLevel Only statements with this level and above will be logged
   */
  static restore(
    indexerUri: string,
    indexerWsUri: string,
    proverServerUri: string,
    substrateNodeUri: string,
    serializedState: string,
    minLogLevel?: LogLevel,
  ): Promise<Wallet & Resource>;

  static calculateCost(tx: Transaction): bigint;

  static generateInitialState(): string;
}
