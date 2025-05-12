import * as zswap from '@midnight-ntwrk/zswap';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { Observable } from 'rxjs';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Resource {
  start(): void;

  close(): Promise<void>;
}

export declare class WalletBuilder {
  /**
   * Create an instance of a new wallet from a given seed
   * @param indexerUri PubSub-Indexer HTTP URI
   * @param indexerWsUri PubSub-Indexer Websockets URI
   * @param proverServerUri Prover server URI
   * @param substrateNodeUri Node URI
   * @param seed A BIP32 compatible mnemonic seed phrase hex encoded
   * @param networkId The network identifier (TestNet, MainNet, or Undeployed)
   * @param minLogLevel Only statements with this level and above will be logged
   * @param discardTxHistory If transaction history should be discarded or kept in memory - undefined will default to false
   */
  static build(
    indexerUri: string,
    indexerWsUri: string,
    proverServerUri: string,
    substrateNodeUri: string,
    seed: string,
    networkId: zswap.NetworkId,
    minLogLevel?: LogLevel,
    discardTxHistory?: boolean,
  ): Promise<Wallet & Resource>;

  /**
   *  @deprecated Use build() instead.
   *
   * Build a wallet from a BIP32 compatible seed phrase
   * @param indexerUri PubSub-Indexer HTTP URI
   * @param indexerWsUri PubSub-Indexer Websockets URI
   * @param proverServerUri Prover server URI
   * @param substrateNodeUri Node URI
   * @param seed A BIP32 compatible mnemonic seed phrase hex encoded
   * @param networkId The network identifier (TestNet, MainNet, or Undeployed)
   * @param minLogLevel Only statements with this level and above will be logged
   * @param discardTxHistory If transaction history should be discarded or kept in memory - undefined will default to false
   */
  static buildFromSeed(
    indexerUri: string,
    indexerWsUri: string,
    proverServerUri: string,
    substrateNodeUri: string,
    seed: string,
    networkId: zswap.NetworkId,
    minLogLevel?: LogLevel,
    discardTxHistory?: boolean,
  ): Promise<Wallet & Resource>;

  /**
   *
   * Create an instance of wallet with a given seed and its serialized state
   * @param indexerUri PubSub-Indexer HTTP URI
   * @param indexerWsUri PubSub-Indexer Websockets URI
   * @param proverServerUri Prover server URI
   * @param substrateNodeUri Node URI
   * @param seed A BIP32 compatible mnemonic seed phrase hex encoded
   * @param serializedState Serialized (JSON) state containing LocalState, Transaction History and Block Height
   * @param minLogLevel Only statements with this level and above will be logged
   * @param discardTxHistory If transaction history should be discarded or kept in memory - undefined will default to false
   */
  static restore(
    indexerUri: string,
    indexerWsUri: string,
    proverServerUri: string,
    substrateNodeUri: string,
    seed: string,
    serializedState: string,
    minLogLevel?: LogLevel,
    discardTxHistory?: boolean,
  ): Promise<Wallet & Resource>;

  static calculateCost(tx: zswap.Transaction): bigint;

  static generateInitialState(networkId: zswap.NetworkId): string;
}

/* infra and helpers */

export declare class NetworkId {
  static fromJs(id: zswap.NetworkId): NetworkId;
}
export declare class TracerCarrier {
  static createLoggingTracer(logLevel: LogLevel): TracerCarrier;
}

export interface Allocated<T> {
  value: T;
  deallocate: () => Promise<void>;
}
export declare class JsResource<T> {
  allocate(): Promise<Allocated<T>>;
}

export declare class ScalaEither<A, B> {}
export declare class JsEither {
  static fold<A, B, R>(either: ScalaEither<A, B>, onLeft: (a: A) => R, onRight: (b: B) => R): R;
}

export declare class IndexerClient {
  static create(wsUrl: string, tracer: TracerCarrier): JsResource<IndexerClient>;
}

/* Zswap typeclasses */
export declare interface Transaction<Tx> {}
export declare const V1Transaction: Transaction<zswap.Transaction>;

export declare interface EvolveState<State, SecretKeys> {}
export declare const V1EvolveState: EvolveState<zswap.LocalState, zswap.SecretKeys>;

export declare interface EncryptionSecretKey<ESK> {}
export declare const V1EncryptionSecretKey: EncryptionSecretKey<zswap.EncryptionSecretKey>;

/* blockchain / domain types */
export declare class IndexerUpdateEvent {}
export declare class IndexerUpdate {}
export declare class Progress {
  readonly isComplete: boolean;
}

/* Wallet and capabilities */
export declare class CoreWallet<State, SecretKeys> {
  static emptyV1(
    localState: zswap.LocalState,
    secretKeys: zswap.SecretKeys,
    networkId: NetworkId,
  ): CoreWallet<zswap.LocalState, zswap.SecretKeys>;

  readonly state: State;
  readonly secretKeys: SecretKeys;
  readonly isConnected: boolean;
  readonly progress: Progress;
}
export declare class DefaultTxHistoryCapability {}

export declare class DefaultSyncCapability<S, K> {
  constructor(
    txHistoryCapability: DefaultTxHistoryCapability,
    tx: Transaction<zswap.Transaction>,
    evolveState: EvolveState<S, K>,
  );

  applyUpdate<S, K>(wallet: CoreWallet<S, K>, update: IndexerUpdate): ScalaEither<Error, CoreWallet<S, K>>;
}

export declare class V1Combination {
  static mapIndexerEvent(event: IndexerUpdateEvent, networkId: NetworkId): Promise<IndexerUpdate>;
}

/* services */

export declare class DefaultSyncService {
  static create(client: IndexerClient, bech32mESK: string, index: bigint | undefined): DefaultSyncService;

  sync$(): Observable<IndexerUpdateEvent>;
}
