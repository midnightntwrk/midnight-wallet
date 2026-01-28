/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  CardanoRewardAddress: { input: string; output: string; }
  DustAddress: { input: string; output: string; }
  HexEncoded: { input: string; output: string; }
  Unit: { input: null; output: null; }
  UnshieldedAddress: { input: string; output: string; }
  ViewingKey: { input: string; output: string; }
};

/** A block with its relevant data. */
export type Block = {
  /** The hex-encoded block author. */
  author: Maybe<Scalars['HexEncoded']['output']>;
  /** The block hash. */
  hash: Scalars['HexEncoded']['output'];
  /** The block height. */
  height: Scalars['Int']['output'];
  /** The hex-encoded ledger parameters for this block. */
  ledgerParameters: Scalars['HexEncoded']['output'];
  /** The parent of this block. */
  parent: Maybe<Block>;
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The system parameters (governance) at this block height. */
  systemParameters: SystemParameters;
  /** The UNIX timestamp. */
  timestamp: Scalars['Int']['output'];
  /** The transactions within this block. */
  transactions: Array<Transaction>;
};

/** Either a block hash or a block height. */
export type BlockOffset =
  /** A hex-encoded block hash. */
  { hash: Scalars['HexEncoded']['input']; height?: never; }
  |  /** A block height. */
  { hash?: never; height: Scalars['Int']['input']; };

export type CollapsedMerkleTree = {
  /** The zswap state end index. */
  endIndex: Scalars['Int']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The zswap state start index. */
  startIndex: Scalars['Int']['output'];
  /** The hex-encoded value. */
  update: Scalars['HexEncoded']['output'];
};

/** Committee member for an epoch. */
export type CommitteeMember = {
  auraPubkeyHex: Maybe<Scalars['String']['output']>;
  epochNo: Scalars['Int']['output'];
  expectedSlots: Scalars['Int']['output'];
  poolIdHex: Maybe<Scalars['String']['output']>;
  position: Scalars['Int']['output'];
  sidechainPubkeyHex: Scalars['String']['output'];
  spoSkHex: Maybe<Scalars['String']['output']>;
};

/** A contract action. */
export type ContractAction = {
  address: Scalars['HexEncoded']['output'];
  state: Scalars['HexEncoded']['output'];
  transaction: Transaction;
  unshieldedBalances: Array<ContractBalance>;
  zswapState: Scalars['HexEncoded']['output'];
};

/** Either a block offset or a transaction offset. */
export type ContractActionOffset =
  /** Either a block hash or a block height. */
  { blockOffset: BlockOffset; transactionOffset?: never; }
  |  /** Either a transaction hash or a transaction identifier. */
  { blockOffset?: never; transactionOffset: TransactionOffset; };

/**
 * Represents a token balance held by a contract.
 * This type is exposed through the GraphQL API to allow clients to query
 * unshielded token balances for any contract action (Deploy, Call, Update).
 */
export type ContractBalance = {
  /** Balance amount as string to support larger integer values (up to 16 bytes). */
  amount: Scalars['String']['output'];
  /** Hex-encoded token type identifier. */
  tokenType: Scalars['HexEncoded']['output'];
};

/** A contract call. */
export type ContractCall = ContractAction & {
  /** The hex-encoded serialized address. */
  address: Scalars['HexEncoded']['output'];
  /** Contract deploy for this contract call. */
  deploy: ContractDeploy;
  /** The entry point. */
  entryPoint: Scalars['String']['output'];
  /** The hex-encoded serialized state. */
  state: Scalars['HexEncoded']['output'];
  /** Transaction for this contract call. */
  transaction: Transaction;
  /** Unshielded token balances held by this contract. */
  unshieldedBalances: Array<ContractBalance>;
  /** The hex-encoded serialized contract-specific zswap state. */
  zswapState: Scalars['HexEncoded']['output'];
};

/** A contract deployment. */
export type ContractDeploy = ContractAction & {
  /** The hex-encoded serialized address. */
  address: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized state. */
  state: Scalars['HexEncoded']['output'];
  /** Transaction for this contract deploy. */
  transaction: Transaction;
  /** Unshielded token balances held by this contract. */
  unshieldedBalances: Array<ContractBalance>;
  /** The hex-encoded serialized contract-specific zswap state. */
  zswapState: Scalars['HexEncoded']['output'];
};

/** A contract update. */
export type ContractUpdate = ContractAction & {
  /** The hex-encoded serialized address. */
  address: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized state. */
  state: Scalars['HexEncoded']['output'];
  /** Transaction for this contract update. */
  transaction: Transaction;
  /** Unshielded token balances held by this contract after the update. */
  unshieldedBalances: Array<ContractBalance>;
  /** The hex-encoded serialized contract-specific zswap state. */
  zswapState: Scalars['HexEncoded']['output'];
};

/** The D-parameter controlling validator committee composition. */
export type DParameter = {
  /** Number of permissioned candidates. */
  numPermissionedCandidates: Scalars['Int']['output'];
  /** Number of registered candidates. */
  numRegisteredCandidates: Scalars['Int']['output'];
};

/** D-parameter change record for history queries. */
export type DParameterChange = {
  /** The hex-encoded block hash where this parameter became effective. */
  blockHash: Scalars['HexEncoded']['output'];
  /** The block height where this parameter became effective. */
  blockHeight: Scalars['Int']['output'];
  /** Number of permissioned candidates. */
  numPermissionedCandidates: Scalars['Int']['output'];
  /** Number of registered candidates. */
  numRegisteredCandidates: Scalars['Int']['output'];
  /** The UNIX timestamp when this parameter became effective. */
  timestamp: Scalars['Int']['output'];
};

export type DustGenerationDtimeUpdate = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  maxId: Scalars['Int']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  raw: Scalars['HexEncoded']['output'];
};

/** DUST generation status for a specific Cardano reward address. */
export type DustGenerationStatus = {
  /** The Bech32-encoded Cardano reward address (e.g., stake_test1... or stake1...). */
  cardanoRewardAddress: Scalars['CardanoRewardAddress']['output'];
  /** Current generated DUST capacity in SPECK. */
  currentCapacity: Scalars['String']['output'];
  /** The Bech32m-encoded associated DUST address if registered. */
  dustAddress: Maybe<Scalars['DustAddress']['output']>;
  /** DUST generation rate in SPECK per second. */
  generationRate: Scalars['String']['output'];
  /** Maximum DUST capacity in SPECK. */
  maxCapacity: Scalars['String']['output'];
  /** NIGHT balance backing generation in STAR. */
  nightBalance: Scalars['String']['output'];
  /** Whether this reward address is registered. */
  registered: Scalars['Boolean']['output'];
  /** Cardano UTXO output index for update/unregister operations. */
  utxoOutputIndex: Maybe<Scalars['Int']['output']>;
  /** Cardano UTXO transaction hash for update/unregister operations. */
  utxoTxHash: Maybe<Scalars['HexEncoded']['output']>;
};

export type DustInitialUtxo = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  maxId: Scalars['Int']['output'];
  /** The dust output. */
  output: DustOutput;
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  raw: Scalars['HexEncoded']['output'];
};

/** A dust related ledger event. */
export type DustLedgerEvent = {
  id: Scalars['Int']['output'];
  maxId: Scalars['Int']['output'];
  protocolVersion: Scalars['Int']['output'];
  raw: Scalars['HexEncoded']['output'];
};

/** A dust output. */
export type DustOutput = {
  /** The hex-encoded 32-byte nonce. */
  nonce: Scalars['HexEncoded']['output'];
};

export type DustSpendProcessed = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  maxId: Scalars['Int']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  raw: Scalars['HexEncoded']['output'];
};

/** Current epoch information. */
export type EpochInfo = {
  durationSeconds: Scalars['Int']['output'];
  elapsedSeconds: Scalars['Int']['output'];
  epochNo: Scalars['Int']['output'];
};

/** SPO performance for an epoch. */
export type EpochPerf = {
  epochNo: Scalars['Int']['output'];
  expected: Scalars['Int']['output'];
  identityLabel: Maybe<Scalars['String']['output']>;
  poolIdHex: Maybe<Scalars['String']['output']>;
  produced: Scalars['Int']['output'];
  spoSkHex: Scalars['String']['output'];
  stakeSnapshot: Maybe<Scalars['String']['output']>;
  validatorClass: Maybe<Scalars['String']['output']>;
};

/** First valid epoch for an SPO identity. */
export type FirstValidEpoch = {
  firstValidEpoch: Scalars['Int']['output'];
  idKey: Scalars['String']['output'];
};

export type Mutation = {
  /** Connect the wallet with the given viewing key and return a session ID. */
  connect: Scalars['HexEncoded']['output'];
  /** Disconnect the wallet with the given session ID. */
  disconnect: Scalars['Unit']['output'];
};


export type MutationConnectArgs = {
  viewingKey: Scalars['ViewingKey']['input'];
};


export type MutationDisconnectArgs = {
  sessionId: Scalars['HexEncoded']['input'];
};

export type ParamChange = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  maxId: Scalars['Int']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  raw: Scalars['HexEncoded']['output'];
};

/** Pool metadata from Cardano. */
export type PoolMetadata = {
  hexId: Maybe<Scalars['String']['output']>;
  homepageUrl: Maybe<Scalars['String']['output']>;
  logoUrl: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  poolIdHex: Scalars['String']['output'];
  ticker: Maybe<Scalars['String']['output']>;
};

/** Presence event for an SPO in an epoch. */
export type PresenceEvent = {
  epochNo: Scalars['Int']['output'];
  idKey: Scalars['String']['output'];
  source: Scalars['String']['output'];
  status: Maybe<Scalars['String']['output']>;
};

export type Query = {
  /** Find a block for the given optional offset; if not present, the latest block is returned. */
  block: Maybe<Block>;
  /** Get committee membership for an epoch. */
  committee: Array<CommitteeMember>;
  /** Find a contract action for the given address and optional offset. */
  contractAction: Maybe<ContractAction>;
  /** Get current epoch information. */
  currentEpochInfo: Maybe<EpochInfo>;
  /** Get the full history of D-parameter changes for governance auditability. */
  dParameterHistory: Array<DParameterChange>;
  /** Get DUST generation status for specific Cardano reward addresses. */
  dustGenerationStatus: Array<DustGenerationStatus>;
  /** Get epoch performance for all SPOs. */
  epochPerformance: Array<EpochPerf>;
  /** Get epoch utilization (produced/expected ratio). */
  epochUtilization: Maybe<Scalars['Float']['output']>;
  /** Get pool metadata by pool ID. */
  poolMetadata: Maybe<PoolMetadata>;
  /** List pool metadata with pagination. */
  poolMetadataList: Array<PoolMetadata>;
  /** Get first valid epoch for each SPO identity. */
  registeredFirstValidEpochs: Array<FirstValidEpoch>;
  /** Get raw presence events for an epoch range. */
  registeredPresence: Array<PresenceEvent>;
  /** Get registration statistics for an epoch range. */
  registeredSpoSeries: Array<RegisteredStat>;
  /** Get cumulative registration totals for an epoch range. */
  registeredTotalsSeries: Array<RegisteredTotals>;
  /** Get SPO with metadata by pool ID. */
  spoByPoolId: Maybe<Spo>;
  /** Get composite SPO data (identity + metadata + performance). */
  spoCompositeByPoolId: Maybe<SpoComposite>;
  /** Get total count of SPOs. */
  spoCount: Maybe<Scalars['Int']['output']>;
  /** List SPO identities with pagination. */
  spoIdentities: Array<SpoIdentity>;
  /** Get SPO identity by pool ID. */
  spoIdentityByPoolId: Maybe<SpoIdentity>;
  /** List SPOs with optional search. */
  spoList: Array<Spo>;
  /** Get SPO performance by SPO key. */
  spoPerformanceBySpoSk: Array<EpochPerf>;
  /** Get latest SPO performance entries. */
  spoPerformanceLatest: Array<EpochPerf>;
  /** Get stake distribution with search and ordering. */
  stakeDistribution: Array<StakeShare>;
  /** Get SPO identifiers ordered by performance. */
  stakePoolOperators: Array<Scalars['String']['output']>;
  /** Get the full history of Terms and Conditions changes for governance auditability. */
  termsAndConditionsHistory: Array<TermsAndConditionsChange>;
  /** Find transactions for the given offset. */
  transactions: Array<Transaction>;
};


export type QueryBlockArgs = {
  offset: InputMaybe<BlockOffset>;
};


export type QueryCommitteeArgs = {
  epoch: Scalars['Int']['input'];
};


export type QueryContractActionArgs = {
  address: Scalars['HexEncoded']['input'];
  offset: InputMaybe<ContractActionOffset>;
};


export type QueryDustGenerationStatusArgs = {
  cardanoRewardAddresses: Array<Scalars['CardanoRewardAddress']['input']>;
};


export type QueryEpochPerformanceArgs = {
  epoch: Scalars['Int']['input'];
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
};


export type QueryEpochUtilizationArgs = {
  epoch: Scalars['Int']['input'];
};


export type QueryPoolMetadataArgs = {
  poolIdHex: Scalars['String']['input'];
};


export type QueryPoolMetadataListArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  withNameOnly: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryRegisteredFirstValidEpochsArgs = {
  uptoEpoch: InputMaybe<Scalars['Int']['input']>;
};


export type QueryRegisteredPresenceArgs = {
  fromEpoch: Scalars['Int']['input'];
  toEpoch: Scalars['Int']['input'];
};


export type QueryRegisteredSpoSeriesArgs = {
  fromEpoch: Scalars['Int']['input'];
  toEpoch: Scalars['Int']['input'];
};


export type QueryRegisteredTotalsSeriesArgs = {
  fromEpoch: Scalars['Int']['input'];
  toEpoch: Scalars['Int']['input'];
};


export type QuerySpoByPoolIdArgs = {
  poolIdHex: Scalars['String']['input'];
};


export type QuerySpoCompositeByPoolIdArgs = {
  poolIdHex: Scalars['String']['input'];
};


export type QuerySpoIdentitiesArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
};


export type QuerySpoIdentityByPoolIdArgs = {
  poolIdHex: Scalars['String']['input'];
};


export type QuerySpoListArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type QuerySpoPerformanceBySpoSkArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  spoSkHex: Scalars['String']['input'];
};


export type QuerySpoPerformanceLatestArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
};


export type QueryStakeDistributionArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  orderByStakeDesc: InputMaybe<Scalars['Boolean']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type QueryStakePoolOperatorsArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type QueryTransactionsArgs = {
  offset: TransactionOffset;
};

/** Registration statistics for an epoch. */
export type RegisteredStat = {
  dparam: Maybe<Scalars['Float']['output']>;
  epochNo: Scalars['Int']['output'];
  federatedInvalidCount: Scalars['Int']['output'];
  federatedValidCount: Scalars['Int']['output'];
  registeredInvalidCount: Scalars['Int']['output'];
  registeredValidCount: Scalars['Int']['output'];
};

/** Cumulative registration totals for an epoch. */
export type RegisteredTotals = {
  epochNo: Scalars['Int']['output'];
  newlyRegistered: Scalars['Int']['output'];
  totalRegistered: Scalars['Int']['output'];
};

/** A regular Midnight transaction. */
export type RegularTransaction = Transaction & {
  /** The block for this transaction. */
  block: Block;
  /** The contract actions for this transaction. */
  contractActions: Array<ContractAction>;
  /** Dust ledger events of this transaction. */
  dustLedgerEvents: Array<DustLedgerEvent>;
  /** The zswap state end index. */
  endIndex: Scalars['Int']['output'];
  /** Fee information for this transaction. */
  fees: TransactionFees;
  /** The hex-encoded transaction hash. */
  hash: Scalars['HexEncoded']['output'];
  /** The transaction ID. */
  id: Scalars['Int']['output'];
  /** The hex-encoded serialized transaction identifiers. */
  identifiers: Array<Scalars['HexEncoded']['output']>;
  /** The hex-encoded serialized merkle-tree root. */
  merkleTreeRoot: Scalars['HexEncoded']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized transaction content. */
  raw: Scalars['HexEncoded']['output'];
  /** The zswap state start index. */
  startIndex: Scalars['Int']['output'];
  /** The result of applying this transaction to the ledger state. */
  transactionResult: TransactionResult;
  /** Unshielded UTXOs created by this transaction. */
  unshieldedCreatedOutputs: Array<UnshieldedUtxo>;
  /** Unshielded UTXOs spent (consumed) by this transaction. */
  unshieldedSpentOutputs: Array<UnshieldedUtxo>;
  /** Zswap ledger events of this transaction. */
  zswapLedgerEvents: Array<ZswapLedgerEvent>;
};

/** A transaction relevant for the subscribing wallet and an optional collapsed merkle tree. */
export type RelevantTransaction = {
  /** An optional collapsed merkle tree. */
  collapsedMerkleTree: Maybe<CollapsedMerkleTree>;
  /** A transaction relevant for the subscribing wallet. */
  transaction: RegularTransaction;
};

/**
 * One of many segments for a partially successful transaction result showing success for some
 * segment.
 */
export type Segment = {
  /** Segment ID. */
  id: Scalars['Int']['output'];
  /** Successful or not. */
  success: Scalars['Boolean']['output'];
};

/** An event of the shielded transactions subscription. */
export type ShieldedTransactionsEvent = RelevantTransaction | ShieldedTransactionsProgress;

/** Information about the shielded transactions indexing progress. */
export type ShieldedTransactionsProgress = {
  /**
   * The highest zswap state end index (see `endIndex` of `Transaction`) of all transactions
   * checked for relevance. Initially less than and eventually (when some wallet has been fully
   * indexed) equal to `highest_end_index`. A value of zero (very unlikely) means that no wallet
   * has subscribed before and indexing for the subscribing wallet has not yet started.
   */
  highestCheckedEndIndex: Scalars['Int']['output'];
  /**
   * The highest zswap state end index (see `endIndex` of `Transaction`) of all transactions. It
   * represents the known state of the blockchain. A value of zero (completely unlikely) means
   * that no shielded transactions have been indexed yet.
   */
  highestEndIndex: Scalars['Int']['output'];
  /**
   * The highest zswap state end index (see `endIndex` of `Transaction`) of all relevant
   * transactions for the subscribing wallet. Usually less than `highest_checked_end_index`
   * unless the latest checked transaction is relevant for the subscribing wallet. A value of
   * zero means that no relevant transactions have been indexed for the subscribing wallet.
   */
  highestRelevantEndIndex: Scalars['Int']['output'];
};

/** SPO with optional metadata. */
export type Spo = {
  auraPubkeyHex: Maybe<Scalars['String']['output']>;
  homepageUrl: Maybe<Scalars['String']['output']>;
  logoUrl: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  poolIdHex: Scalars['String']['output'];
  sidechainPubkeyHex: Scalars['String']['output'];
  ticker: Maybe<Scalars['String']['output']>;
  validatorClass: Scalars['String']['output'];
};

/** Composite SPO data (identity + metadata + performance). */
export type SpoComposite = {
  identity: Maybe<SpoIdentity>;
  metadata: Maybe<PoolMetadata>;
  performance: Array<EpochPerf>;
};

/** SPO identity information. */
export type SpoIdentity = {
  auraPubkeyHex: Maybe<Scalars['String']['output']>;
  mainchainPubkeyHex: Scalars['String']['output'];
  poolIdHex: Scalars['String']['output'];
  sidechainPubkeyHex: Scalars['String']['output'];
  validatorClass: Scalars['String']['output'];
};

/**
 * Stake share information for an SPO.
 *
 * Values are sourced from mainchain pool data (e.g., Blockfrost) and keyed by Cardano pool_id.
 */
export type StakeShare = {
  /** Current active stake in lovelace. */
  activeStake: Maybe<Scalars['String']['output']>;
  /** Declared pledge in lovelace. */
  declaredPledge: Maybe<Scalars['String']['output']>;
  /** Pool homepage URL from metadata. */
  homepageUrl: Maybe<Scalars['String']['output']>;
  /** Number of live delegators. */
  liveDelegators: Maybe<Scalars['Int']['output']>;
  /** Current live pledge in lovelace. */
  livePledge: Maybe<Scalars['String']['output']>;
  /** Saturation ratio (0.0 to 1.0+). */
  liveSaturation: Maybe<Scalars['Float']['output']>;
  /** Current live stake in lovelace. */
  liveStake: Maybe<Scalars['String']['output']>;
  /** Pool logo URL from metadata. */
  logoUrl: Maybe<Scalars['String']['output']>;
  /** Pool name from metadata. */
  name: Maybe<Scalars['String']['output']>;
  /** Cardano pool ID (56-character hex string). */
  poolIdHex: Scalars['String']['output'];
  /** Stake share as a fraction of total stake. */
  stakeShare: Maybe<Scalars['Float']['output']>;
  /** Pool ticker from metadata. */
  ticker: Maybe<Scalars['String']['output']>;
};

export type Subscription = {
  /**
   * Subscribe to blocks starting at the given offset or at the latest block if the offset is
   * omitted.
   */
  blocks: Block;
  /**
   * Subscribe to contract actions with the given address starting at the given offset or at the
   * latest block if the offset is omitted.
   */
  contractActions: ContractAction;
  /** Subscribe to dust ledger events starting at the given ID or at the very start if omitted. */
  dustLedgerEvents: DustLedgerEvent;
  /**
   * Subscribe to shielded transaction events for the given session ID starting at the given
   * index or at zero if omitted.
   */
  shieldedTransactions: ShieldedTransactionsEvent;
  /**
   * Subscribe unshielded transaction events for the given address and the given transaction ID
   * or zero if omitted.
   */
  unshieldedTransactions: UnshieldedTransactionsEvent;
  /** Subscribe to zswap ledger events starting at the given ID or at the very start if omitted. */
  zswapLedgerEvents: ZswapLedgerEvent;
};


export type SubscriptionBlocksArgs = {
  offset: InputMaybe<BlockOffset>;
};


export type SubscriptionContractActionsArgs = {
  address: Scalars['HexEncoded']['input'];
  offset: InputMaybe<BlockOffset>;
};


export type SubscriptionDustLedgerEventsArgs = {
  id: InputMaybe<Scalars['Int']['input']>;
};


export type SubscriptionShieldedTransactionsArgs = {
  index: InputMaybe<Scalars['Int']['input']>;
  sessionId: Scalars['HexEncoded']['input'];
};


export type SubscriptionUnshieldedTransactionsArgs = {
  address: Scalars['UnshieldedAddress']['input'];
  transactionId: InputMaybe<Scalars['Int']['input']>;
};


export type SubscriptionZswapLedgerEventsArgs = {
  id: InputMaybe<Scalars['Int']['input']>;
};

/** System parameters at a specific block height. */
export type SystemParameters = {
  /** The D-parameter controlling validator committee composition. */
  dParameter: DParameter;
  /** The current Terms and Conditions, if any have been set. */
  termsAndConditions: Maybe<TermsAndConditions>;
};

/** A system Midnight transaction. */
export type SystemTransaction = Transaction & {
  /** The block for this transaction. */
  block: Block;
  /** The contract actions for this transaction. */
  contractActions: Array<ContractAction>;
  /** Dust ledger events of this transaction. */
  dustLedgerEvents: Array<DustLedgerEvent>;
  /** The hex-encoded transaction hash. */
  hash: Scalars['HexEncoded']['output'];
  /** The transaction ID. */
  id: Scalars['Int']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized transaction content. */
  raw: Scalars['HexEncoded']['output'];
  /** Unshielded UTXOs created by this transaction. */
  unshieldedCreatedOutputs: Array<UnshieldedUtxo>;
  /** Unshielded UTXOs spent (consumed) by this transaction. */
  unshieldedSpentOutputs: Array<UnshieldedUtxo>;
  /** Zswap ledger events of this transaction. */
  zswapLedgerEvents: Array<ZswapLedgerEvent>;
};

/** Terms and Conditions agreement. */
export type TermsAndConditions = {
  /** The hex-encoded hash of the Terms and Conditions document. */
  hash: Scalars['HexEncoded']['output'];
  /** The URL where the Terms and Conditions can be found. */
  url: Scalars['String']['output'];
};

/** Terms and Conditions change record for history queries. */
export type TermsAndConditionsChange = {
  /** The hex-encoded block hash where this T&C version became effective. */
  blockHash: Scalars['HexEncoded']['output'];
  /** The block height where this T&C version became effective. */
  blockHeight: Scalars['Int']['output'];
  /** The hex-encoded hash of the Terms and Conditions document. */
  hash: Scalars['HexEncoded']['output'];
  /** The UNIX timestamp when this T&C version became effective. */
  timestamp: Scalars['Int']['output'];
  /** The URL where the Terms and Conditions can be found. */
  url: Scalars['String']['output'];
};

/** A Midnight transaction. */
export type Transaction = {
  block: Block;
  contractActions: Array<ContractAction>;
  dustLedgerEvents: Array<DustLedgerEvent>;
  hash: Scalars['HexEncoded']['output'];
  id: Scalars['Int']['output'];
  protocolVersion: Scalars['Int']['output'];
  raw: Scalars['HexEncoded']['output'];
  unshieldedCreatedOutputs: Array<UnshieldedUtxo>;
  unshieldedSpentOutputs: Array<UnshieldedUtxo>;
  zswapLedgerEvents: Array<ZswapLedgerEvent>;
};

/** Fees information for a transaction, including both paid and estimated fees. */
export type TransactionFees = {
  /** The estimated fees that was calculated for this transaction in DUST. */
  estimatedFees: Scalars['String']['output'];
  /** The actual fees paid for this transaction in DUST. */
  paidFees: Scalars['String']['output'];
};

/** Either a transaction hash or a transaction identifier. */
export type TransactionOffset =
  /** A hex-encoded transaction hash. */
  { hash: Scalars['HexEncoded']['input']; identifier?: never; }
  |  /** A hex-encoded transaction identifier. */
  { hash?: never; identifier: Scalars['HexEncoded']['input']; };

/**
 * The result of applying a transaction to the ledger state. In case of a partial success (status),
 * there will be segments.
 */
export type TransactionResult = {
  segments: Maybe<Array<Segment>>;
  status: TransactionResultStatus;
};

/** The status of the transaction result: success, partial success or failure. */
export type TransactionResultStatus =
  | 'FAILURE'
  | 'PARTIAL_SUCCESS'
  | 'SUCCESS'
  | '%future added value';

/** A transaction that created and/or spent UTXOs alongside these and other information. */
export type UnshieldedTransaction = {
  /** UTXOs created in the above transaction, possibly empty. */
  createdUtxos: Array<UnshieldedUtxo>;
  /** UTXOs spent in the above transaction, possibly empty. */
  spentUtxos: Array<UnshieldedUtxo>;
  /** The transaction that created and/or spent UTXOs. */
  transaction: Transaction;
};

/** An event of the unshielded transactions subscription. */
export type UnshieldedTransactionsEvent = UnshieldedTransaction | UnshieldedTransactionsProgress;

/** Information about the unshielded indexing progress. */
export type UnshieldedTransactionsProgress = {
  /** The highest transaction ID of all currently known transactions for a subscribed address. */
  highestTransactionId: Scalars['Int']['output'];
};

/** Represents an unshielded UTXO. */
export type UnshieldedUtxo = {
  /** Transaction that created this UTXO. */
  createdAtTransaction: Transaction;
  /** The creation time in seconds. */
  ctime: Maybe<Scalars['Int']['output']>;
  /** The hex-encoded initial nonce for DUST generation tracking. */
  initialNonce: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized intent hash. */
  intentHash: Scalars['HexEncoded']['output'];
  /** Index of this output within its creating transaction. */
  outputIndex: Scalars['Int']['output'];
  /** Owner Bech32m-encoded address. */
  owner: Scalars['UnshieldedAddress']['output'];
  /** Whether this UTXO is registered for DUST generation. */
  registeredForDustGeneration: Scalars['Boolean']['output'];
  /** Transaction that spent this UTXO. */
  spentAtTransaction: Maybe<Transaction>;
  /** Token hex-encoded serialized token type. */
  tokenType: Scalars['HexEncoded']['output'];
  /** UTXO value (quantity) as a string to support u128. */
  value: Scalars['String']['output'];
};

/** A zswap related ledger event. */
export type ZswapLedgerEvent = {
  /** The ID of this zswap ledger event. */
  id: Scalars['Int']['output'];
  /** The maximum ID of all zswap ledger events. */
  maxId: Scalars['Int']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  raw: Scalars['HexEncoded']['output'];
};

export type BlockHashQueryVariables = Exact<{
  offset: InputMaybe<BlockOffset>;
}>;


export type BlockHashQuery = { block: { height: number, hash: string, ledgerParameters: string, timestamp: number } | null };

export type ConnectMutationVariables = Exact<{
  viewingKey: Scalars['ViewingKey']['input'];
}>;


export type ConnectMutation = { connect: string };

export type DisconnectMutationVariables = Exact<{
  sessionId: Scalars['HexEncoded']['input'];
}>;


export type DisconnectMutation = { disconnect: null };

export type TransactionHistoryDetailQueryVariables = Exact<{
  transactionHash: Scalars['HexEncoded']['input'];
}>;


export type TransactionHistoryDetailQuery = { transactions: Array<{ __typename: 'RegularTransaction', hash: string, transactionResult: { status: TransactionResultStatus }, block: { timestamp: number } } | { __typename: 'SystemTransaction', hash: string, block: { timestamp: number } }> };

export type TransactionStatusQueryVariables = Exact<{
  transactionId: Scalars['HexEncoded']['input'];
}>;


export type TransactionStatusQuery = { transactions: Array<{ __typename: 'RegularTransaction', identifiers: Array<string>, transactionResult: { __typename: 'TransactionResult', status: TransactionResultStatus, segments: Array<{ id: number, success: boolean }> | null } } | { __typename: 'SystemTransaction' }> };

export type DustLedgerEventsSubscriptionVariables = Exact<{
  id: InputMaybe<Scalars['Int']['input']>;
}>;


export type DustLedgerEventsSubscription = { dustLedgerEvents: { id: number, raw: string, maxId: number, type: 'DustGenerationDtimeUpdate' } | { id: number, raw: string, maxId: number, type: 'DustInitialUtxo' } | { id: number, raw: string, maxId: number, type: 'DustSpendProcessed' } | { id: number, raw: string, maxId: number, type: 'ParamChange' } };

export type ShieldedTransactionsSubscriptionVariables = Exact<{
  sessionId: Scalars['HexEncoded']['input'];
  index: InputMaybe<Scalars['Int']['input']>;
}>;


export type ShieldedTransactionsSubscription = { shieldedTransactions: { __typename: 'RelevantTransaction', transaction: { id: number, raw: string, hash: string, protocolVersion: number, identifiers: Array<string>, startIndex: number, endIndex: number, fees: { paidFees: string, estimatedFees: string }, transactionResult: { status: TransactionResultStatus, segments: Array<{ id: number, success: boolean }> | null } }, collapsedMerkleTree: { startIndex: number, endIndex: number, update: string, protocolVersion: number } | null } | { __typename: 'ShieldedTransactionsProgress', highestEndIndex: number, highestCheckedEndIndex: number, highestRelevantEndIndex: number } };

export type UnshieldedTransactionsSubscriptionVariables = Exact<{
  address: Scalars['UnshieldedAddress']['input'];
  transactionId: InputMaybe<Scalars['Int']['input']>;
}>;


export type UnshieldedTransactionsSubscription = { unshieldedTransactions: { type: 'UnshieldedTransaction', transaction: { identifiers: Array<string>, id: number, hash: string, protocolVersion: number, type: 'RegularTransaction', fees: { paidFees: string, estimatedFees: string }, transactionResult: { status: TransactionResultStatus, segments: Array<{ id: number, success: boolean }> | null }, block: { timestamp: number } } | { id: number, hash: string, protocolVersion: number, type: 'SystemTransaction', block: { timestamp: number } }, createdUtxos: Array<{ owner: string, tokenType: string, value: string, outputIndex: number, intentHash: string, ctime: number | null, registeredForDustGeneration: boolean }>, spentUtxos: Array<{ owner: string, tokenType: string, value: string, outputIndex: number, intentHash: string, ctime: number | null, registeredForDustGeneration: boolean }> } | { highestTransactionId: number, type: 'UnshieldedTransactionsProgress' } };

export type ZswapEventsSubscriptionVariables = Exact<{
  id: InputMaybe<Scalars['Int']['input']>;
}>;


export type ZswapEventsSubscription = { zswapLedgerEvents: { id: number, raw: string, protocolVersion: number, maxId: number } };


export const BlockHashDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BlockHash"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BlockOffset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"block"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"ledgerParameters"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<BlockHashQuery, BlockHashQueryVariables>;
export const ConnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Connect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ViewingKey"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"viewingKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}}}]}]}}]} as unknown as DocumentNode<ConnectMutation, ConnectMutationVariables>;
export const DisconnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Disconnect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disconnect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}]}]}}]} as unknown as DocumentNode<DisconnectMutation, DisconnectMutationVariables>;
export const TransactionHistoryDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TransactionHistoryDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionHash"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"hash"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionHash"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}}]} as unknown as DocumentNode<TransactionHistoryDetailQuery, TransactionHistoryDetailQueryVariables>;
export const TransactionStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TransactionStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]}}]}}]} as unknown as DocumentNode<TransactionStatusQuery, TransactionStatusQueryVariables>;
export const DustLedgerEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"DustLedgerEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dustLedgerEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"maxId"}}]}}]}}]} as unknown as DocumentNode<DustLedgerEventsSubscription, DustLedgerEventsSubscriptionVariables>;
export const ShieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ShieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"index"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"index"},"value":{"kind":"Variable","name":{"kind":"Name","value":"index"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ShieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"highestEndIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestCheckedEndIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestRelevantEndIndex"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RelevantTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"startIndex"}},{"kind":"Field","name":{"kind":"Name","value":"endIndex"}},{"kind":"Field","name":{"kind":"Name","value":"fees"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paidFees"}},{"kind":"Field","name":{"kind":"Name","value":"estimatedFees"}}]}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"collapsedMerkleTree"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startIndex"}},{"kind":"Field","name":{"kind":"Name","value":"endIndex"}},{"kind":"Field","name":{"kind":"Name","value":"update"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ShieldedTransactionsSubscription, ShieldedTransactionsSubscriptionVariables>;
export const UnshieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"UnshieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"address"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedAddress"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unshieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"address"},"value":{"kind":"Variable","name":{"kind":"Name","value":"address"}}},{"kind":"Argument","name":{"kind":"Name","value":"transactionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"fees"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paidFees"}},{"kind":"Field","name":{"kind":"Name","value":"estimatedFees"}}]}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}},{"kind":"Field","name":{"kind":"Name","value":"ctime"}},{"kind":"Field","name":{"kind":"Name","value":"registeredForDustGeneration"}}]}},{"kind":"Field","name":{"kind":"Name","value":"spentUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}},{"kind":"Field","name":{"kind":"Name","value":"ctime"}},{"kind":"Field","name":{"kind":"Name","value":"registeredForDustGeneration"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"highestTransactionId"}}]}}]}}]}}]} as unknown as DocumentNode<UnshieldedTransactionsSubscription, UnshieldedTransactionsSubscriptionVariables>;
export const ZswapEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ZswapEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"zswapLedgerEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"maxId"}}]}}]}}]} as unknown as DocumentNode<ZswapEventsSubscription, ZswapEventsSubscriptionVariables>;