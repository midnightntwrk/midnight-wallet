import * as zswap from '@midnight-ntwrk/zswap';
import { ApplyStage, Wallet, ProvingRecipe } from '@midnight-ntwrk/wallet-api';
import { Observable } from 'rxjs';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Resource {
  start(): void;

  close(): Promise<void>;
}

export declare class WalletError {
  readonly message: string;
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
  readonly name: string;
  readonly toJs: zswap.NetworkId;
  static fromJs(id: zswap.NetworkId): NetworkId;
  static toJs(id: NetworkId): zswap.NetworkId;
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
  static right<B>(value: B): ScalaEither<never, B>;
  static left<A>(value: A): ScalaEither<A, never>;
  static get<A, B>(either: ScalaEither<A, B>): B;
}

export declare class ScalaOption<R> {}

export declare class JsOption {
  static asResult<R>(option: ScalaOption<R>): R | undefined;
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

export declare class ProgressUpdate {
  appliedIndex: ScalaOption<Offset>;
  highestRelevantWalletIndex: ScalaOption<Offset>;
  highestIndex: ScalaOption<Offset>;
  highestRelevantIndex: ScalaOption<Offset>;
  isComplete: boolean;
  isStrictlyComplete: boolean;
  isCompleteWithin(maxGap: number): boolean;
}

export declare class ProtocolVersion {
  readonly version: bigint;
}

export declare class Offset {
  readonly value: bigint;
}

export declare class AppliedTransaction<Tx> {
  readonly tx: Tx;
  readonly applyState: ApplyStage;
}

/* Wallet and capabilities */
export declare class CoreWallet<State, SecretKeys> {
  static emptyV1(
    localState: zswap.LocalState,
    secretKeys: zswap.SecretKeys,
    networkId: NetworkId,
  ): CoreWallet<zswap.LocalState, zswap.SecretKeys>;

  static fromSnapshot(keys: zswap.SecretKeys, snapshot: Snapshot): CoreWallet<zswap.LocalState, zswap.SecretKeys>;
  static restore(
    secretKeys: zswap.SecretKeys,
    state: zswap.LocalState,
    txHistory: readonly zswap.Transaction[],
    offset: bigint | undefined,
    protocolVersion: bigint,
    networkId: NetworkId,
  ): CoreWallet<zswap.LocalState, zswap.SecretKeys>;

  readonly state: State;
  readonly secretKeys: SecretKeys;
  readonly isConnected: boolean;
  readonly progress: ProgressUpdate;
  readonly protocolVersion: ProtocolVersion;
  readonly networkId: NetworkId;
  readonly offset: ScalaOption<Offset>;

  readonly txHistoryArray: readonly zswap.Transaction[];

  applyTransaction(tx: AppliedTransaction<zswap.Transaction>): CoreWallet<State, SecretKeys>;

  addTransaction(tx: zswap.Transaction): CoreWallet<State, SecretKeys>;
  setOffset(newOffset: bigint): CoreWallet<State, SecretKeys>;

  updateProgress(
    appliedIndex: bigint | undefined,
    highestRelevantWalletIndex: bigint | undefined,
    highestIndex: bigint | undefined,
    highestRelevantIndex: bigint | undefined,
  ): CoreWallet<State, SecretKeys>;

  update(
    appliedIndex: bigint | undefined,
    offset: bigint | undefined,
    protocolVersion: bigint,
    isConnected: boolean,
  ): CoreWallet<State, SecretKeys>;

  updateTxHistory(newTxHistory: readonly zswap.Transaction[]): CoreWallet<State, SecretKeys>;

  /**
   * @deprecated Temporary, only for internal use
   */
  applyState(state: State): CoreWallet<State, SecretKeys>;

  toSnapshot(): Snapshot;
}

export declare class Snapshot {
  readonly state: zswap.LocalState;
  readonly txHistoryArray: ReadonlyArray<Transaction>;
  readonly offset: ScalaOption<Offset>;
  readonly protocolVersion: ProtocolVersion;
  readonly networkId: NetworkId;
}

export declare class DefaultSerializeCapability<TWallet, TAuxiliary> {
  static createV1<TWallet, TAuxiliary>(
    toSnapshot: (wallet: TWallet) => Snapshot,
    fromSnapshot: (auxiliary: TAuxiliary, snapshot: Snapshot) => TWallet,
  ): DefaultSerializeCapability<TWallet, TAuxiliary>;

  serialize(wallet: TWallet): string;
  deserialize(auxiliary: TAuxiliary, serialized: string): ScalaEither<WalletError, TWallet>;
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

export declare class DefaultCoinsCapability<TWallet> {
  static createV1<TWallet>(
    getCoins: (wallet: TWallet) => Array<zswap.QualifiedCoinInfo>,
    getNullifiers: (wallet: TWallet) => Array<zswap.Nullifier>,
    getAvailableCoins: (wallet: TWallet) => Array<zswap.QualifiedCoinInfo>,
    getPendingCoins: (wallet: TWallet) => Array<zswap.CoinInfo>,
  ): DefaultCoinsCapability<TWallet>;
}

export declare class DefaultBalancingCapability<TWallet> {
  static createV1<TWallet>(
    coins: DefaultCoinsCapability<TWallet>,
    applyState: (wallet: TWallet, state: zswap.LocalState) => TWallet,
    getSecretKeys: (wallet: TWallet) => zswap.SecretKeys,
    getState: (wallet: TWallet) => zswap.LocalState,
  ): DefaultBalancingCapability<TWallet>;

  balanceTransaction(
    wallet: TWallet,
    tx: ScalaEither<zswap.Transaction, zswap.UnprovenTransaction>,
    coins: Array<zswap.CoinInfo>,
  ): ScalaEither<WalletError, { wallet: TWallet; result: ProvingRecipe }>;
}

export declare class DefaultTransferCapability<TWallet> {
  static createV1<TWallet>(
    applyTransaction: (wallet: TWallet, tx: AppliedTransaction<zswap.Transaction>) => TWallet,
    getState: (wallet: TWallet) => zswap.LocalState,
    applyState: (wallet: TWallet, state: zswap.LocalState) => TWallet,
    getNetworkId: (wallet: TWallet) => NetworkId,
  ): DefaultTransferCapability<TWallet>;

  prepareTransferRecipe(wallet: TWallet, outputs: TokenTransfer[]): ScalaEither<WalletError, zswap.UnprovenTransaction>;

  applyFailedTransaction(wallet: TWallet, tx: zswap.Transaction): ScalaEither<WalletError, TWallet>;

  applyFailedUnprovenTransaction(wallet: TWallet, tx: zswap.UnprovenTransaction): ScalaEither<WalletError, TWallet>;
}

export declare class V1Combination {
  static mapIndexerEvent(event: IndexerUpdateEvent, networkId: NetworkId): Promise<IndexerUpdate>;
}

/* services */

export declare class DefaultSyncService {
  static create(client: IndexerClient, bech32mESK: string, index: bigint | undefined): DefaultSyncService;

  sync$(): Observable<IndexerUpdateEvent>;
}
