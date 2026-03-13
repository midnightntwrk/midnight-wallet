/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
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
  readonly author: Maybe<Scalars['HexEncoded']['output']>;
  /** The block hash. */
  readonly hash: Scalars['HexEncoded']['output'];
  /** The block height. */
  readonly height: Scalars['Int']['output'];
  /** The hex-encoded ledger parameters for this block. */
  readonly ledgerParameters: Scalars['HexEncoded']['output'];
  /** The parent of this block. */
  readonly parent: Maybe<Block>;
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The system parameters (governance) at this block height. */
  readonly systemParameters: SystemParameters;
  /** The UNIX timestamp. */
  readonly timestamp: Scalars['Int']['output'];
  /** The transactions within this block. */
  readonly transactions: ReadonlyArray<Transaction>;
};

/** Either a block hash or a block height. */
export type BlockOffset =
  /** A hex-encoded block hash. */
  { readonly hash: Scalars['HexEncoded']['input']; readonly height?: never; }
  |  /** A block height. */
  { readonly hash?: never; readonly height: Scalars['Int']['input']; };

export type CollapsedMerkleTree = {
  /** The zswap state end index. */
  readonly endIndex: Scalars['Int']['output'];
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The zswap state start index. */
  readonly startIndex: Scalars['Int']['output'];
  /** The hex-encoded value. */
  readonly update: Scalars['HexEncoded']['output'];
};

/** Committee member for an epoch. */
export type CommitteeMember = {
  readonly auraPubkeyHex: Maybe<Scalars['String']['output']>;
  readonly epochNo: Scalars['Int']['output'];
  readonly expectedSlots: Scalars['Int']['output'];
  readonly poolIdHex: Maybe<Scalars['String']['output']>;
  readonly position: Scalars['Int']['output'];
  readonly sidechainPubkeyHex: Scalars['String']['output'];
  readonly spoSkHex: Maybe<Scalars['String']['output']>;
};

/** A contract action. */
export type ContractAction = {
  readonly address: Scalars['HexEncoded']['output'];
  readonly state: Scalars['HexEncoded']['output'];
  readonly transaction: Transaction;
  readonly unshieldedBalances: ReadonlyArray<ContractBalance>;
  readonly zswapState: Scalars['HexEncoded']['output'];
};

/** Either a block offset or a transaction offset. */
export type ContractActionOffset =
  /** Either a block hash or a block height. */
  { readonly blockOffset: BlockOffset; readonly transactionOffset?: never; }
  |  /** Either a transaction hash or a transaction identifier. */
  { readonly blockOffset?: never; readonly transactionOffset: TransactionOffset; };

/**
 * Represents a token balance held by a contract.
 * This type is exposed through the GraphQL API to allow clients to query
 * unshielded token balances for any contract action (Deploy, Call, Update).
 */
export type ContractBalance = {
  /** Balance amount as string to support larger integer values (up to 16 bytes). */
  readonly amount: Scalars['String']['output'];
  /** Hex-encoded token type identifier. */
  readonly tokenType: Scalars['HexEncoded']['output'];
};

/** A contract call. */
export type ContractCall = ContractAction & {
  /** The hex-encoded serialized address. */
  readonly address: Scalars['HexEncoded']['output'];
  /** Contract deploy for this contract call. */
  readonly deploy: ContractDeploy;
  /** The entry point. */
  readonly entryPoint: Scalars['String']['output'];
  /** The hex-encoded serialized state. */
  readonly state: Scalars['HexEncoded']['output'];
  /** Transaction for this contract call. */
  readonly transaction: Transaction;
  /** Unshielded token balances held by this contract. */
  readonly unshieldedBalances: ReadonlyArray<ContractBalance>;
  /** The hex-encoded serialized contract-specific zswap state. */
  readonly zswapState: Scalars['HexEncoded']['output'];
};

/** A contract deployment. */
export type ContractDeploy = ContractAction & {
  /** The hex-encoded serialized address. */
  readonly address: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized state. */
  readonly state: Scalars['HexEncoded']['output'];
  /** Transaction for this contract deploy. */
  readonly transaction: Transaction;
  /** Unshielded token balances held by this contract. */
  readonly unshieldedBalances: ReadonlyArray<ContractBalance>;
  /** The hex-encoded serialized contract-specific zswap state. */
  readonly zswapState: Scalars['HexEncoded']['output'];
};

/** A contract update. */
export type ContractUpdate = ContractAction & {
  /** The hex-encoded serialized address. */
  readonly address: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized state. */
  readonly state: Scalars['HexEncoded']['output'];
  /** Transaction for this contract update. */
  readonly transaction: Transaction;
  /** Unshielded token balances held by this contract after the update. */
  readonly unshieldedBalances: ReadonlyArray<ContractBalance>;
  /** The hex-encoded serialized contract-specific zswap state. */
  readonly zswapState: Scalars['HexEncoded']['output'];
};

/** The D-parameter controlling validator committee composition. */
export type DParameter = {
  /** Number of permissioned candidates. */
  readonly numPermissionedCandidates: Scalars['Int']['output'];
  /** Number of registered candidates. */
  readonly numRegisteredCandidates: Scalars['Int']['output'];
};

/** D-parameter change record for history queries. */
export type DParameterChange = {
  /** The hex-encoded block hash where this parameter became effective. */
  readonly blockHash: Scalars['HexEncoded']['output'];
  /** The block height where this parameter became effective. */
  readonly blockHeight: Scalars['Int']['output'];
  /** Number of permissioned candidates. */
  readonly numPermissionedCandidates: Scalars['Int']['output'];
  /** Number of registered candidates. */
  readonly numRegisteredCandidates: Scalars['Int']['output'];
  /** The UNIX timestamp when this parameter became effective. */
  readonly timestamp: Scalars['Int']['output'];
};

export type DustGenerationDtimeUpdate = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  readonly id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  readonly maxId: Scalars['Int']['output'];
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  readonly raw: Scalars['HexEncoded']['output'];
};

/** DUST generation status for a specific Cardano reward address. */
export type DustGenerationStatus = {
  /** The Bech32-encoded Cardano reward address (e.g., stake_test1... or stake1...). */
  readonly cardanoRewardAddress: Scalars['CardanoRewardAddress']['output'];
  /** Current generated DUST capacity in SPECK. */
  readonly currentCapacity: Scalars['String']['output'];
  /** The Bech32m-encoded associated DUST address if registered. */
  readonly dustAddress: Maybe<Scalars['DustAddress']['output']>;
  /** DUST generation rate in SPECK per second. */
  readonly generationRate: Scalars['String']['output'];
  /** Maximum DUST capacity in SPECK. */
  readonly maxCapacity: Scalars['String']['output'];
  /** NIGHT balance backing generation in STAR. */
  readonly nightBalance: Scalars['String']['output'];
  /** Whether this reward address is registered. */
  readonly registered: Scalars['Boolean']['output'];
  /** Cardano UTXO output index for update/unregister operations. */
  readonly utxoOutputIndex: Maybe<Scalars['Int']['output']>;
  /** Cardano UTXO transaction hash for update/unregister operations. */
  readonly utxoTxHash: Maybe<Scalars['HexEncoded']['output']>;
};

export type DustInitialUtxo = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  readonly id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  readonly maxId: Scalars['Int']['output'];
  /** The dust output. */
  readonly output: DustOutput;
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  readonly raw: Scalars['HexEncoded']['output'];
};

/** A dust related ledger event. */
export type DustLedgerEvent = {
  readonly id: Scalars['Int']['output'];
  readonly maxId: Scalars['Int']['output'];
  readonly protocolVersion: Scalars['Int']['output'];
  readonly raw: Scalars['HexEncoded']['output'];
};

/** A dust output. */
export type DustOutput = {
  /** The hex-encoded 32-byte nonce. */
  readonly nonce: Scalars['HexEncoded']['output'];
};

export type DustSpendProcessed = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  readonly id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  readonly maxId: Scalars['Int']['output'];
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  readonly raw: Scalars['HexEncoded']['output'];
};

/** Current epoch information. */
export type EpochInfo = {
  readonly durationSeconds: Scalars['Int']['output'];
  readonly elapsedSeconds: Scalars['Int']['output'];
  readonly epochNo: Scalars['Int']['output'];
};

/** SPO performance for an epoch. */
export type EpochPerf = {
  readonly epochNo: Scalars['Int']['output'];
  readonly expected: Scalars['Int']['output'];
  readonly identityLabel: Maybe<Scalars['String']['output']>;
  readonly poolIdHex: Maybe<Scalars['String']['output']>;
  readonly produced: Scalars['Int']['output'];
  readonly spoSkHex: Scalars['String']['output'];
  readonly stakeSnapshot: Maybe<Scalars['String']['output']>;
  readonly validatorClass: Maybe<Scalars['String']['output']>;
};

/** First valid epoch for an SPO identity. */
export type FirstValidEpoch = {
  readonly firstValidEpoch: Scalars['Int']['output'];
  readonly idKey: Scalars['String']['output'];
};

export type Mutation = {
  /** Connect the wallet with the given viewing key and return a session ID. */
  readonly connect: Scalars['HexEncoded']['output'];
  /** Disconnect the wallet with the given session ID. */
  readonly disconnect: Scalars['Unit']['output'];
};


export type MutationConnectArgs = {
  viewingKey: Scalars['ViewingKey']['input'];
};


export type MutationDisconnectArgs = {
  sessionId: Scalars['HexEncoded']['input'];
};

export type ParamChange = DustLedgerEvent & {
  /** The ID of this dust ledger event. */
  readonly id: Scalars['Int']['output'];
  /** The maximum ID of all dust ledger events. */
  readonly maxId: Scalars['Int']['output'];
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  readonly raw: Scalars['HexEncoded']['output'];
};

/** Pool metadata from Cardano. */
export type PoolMetadata = {
  readonly hexId: Maybe<Scalars['String']['output']>;
  readonly homepageUrl: Maybe<Scalars['String']['output']>;
  readonly logoUrl: Maybe<Scalars['String']['output']>;
  readonly name: Maybe<Scalars['String']['output']>;
  readonly poolIdHex: Scalars['String']['output'];
  readonly ticker: Maybe<Scalars['String']['output']>;
};

/** Presence event for an SPO in an epoch. */
export type PresenceEvent = {
  readonly epochNo: Scalars['Int']['output'];
  readonly idKey: Scalars['String']['output'];
  readonly source: Scalars['String']['output'];
  readonly status: Maybe<Scalars['String']['output']>;
};

export type Query = {
  /** Find a block for the given optional offset; if not present, the latest block is returned. */
  readonly block: Maybe<Block>;
  /** Get committee membership for an epoch. */
  readonly committee: ReadonlyArray<CommitteeMember>;
  /** Find a contract action for the given address and optional offset. */
  readonly contractAction: Maybe<ContractAction>;
  /** Get current epoch information. */
  readonly currentEpochInfo: Maybe<EpochInfo>;
  /** Get the full history of D-parameter changes for governance auditability. */
  readonly dParameterHistory: ReadonlyArray<DParameterChange>;
  /** Get DUST generation status for specific Cardano reward addresses. */
  readonly dustGenerationStatus: ReadonlyArray<DustGenerationStatus>;
  /** Get epoch performance for all SPOs. */
  readonly epochPerformance: ReadonlyArray<EpochPerf>;
  /** Get epoch utilization (produced/expected ratio). */
  readonly epochUtilization: Maybe<Scalars['Float']['output']>;
  /** Get pool metadata by pool ID. */
  readonly poolMetadata: Maybe<PoolMetadata>;
  /** List pool metadata with pagination. */
  readonly poolMetadataList: ReadonlyArray<PoolMetadata>;
  /** Get first valid epoch for each SPO identity. */
  readonly registeredFirstValidEpochs: ReadonlyArray<FirstValidEpoch>;
  /** Get raw presence events for an epoch range. */
  readonly registeredPresence: ReadonlyArray<PresenceEvent>;
  /** Get registration statistics for an epoch range. */
  readonly registeredSpoSeries: ReadonlyArray<RegisteredStat>;
  /** Get cumulative registration totals for an epoch range. */
  readonly registeredTotalsSeries: ReadonlyArray<RegisteredTotals>;
  /** Get SPO with metadata by pool ID. */
  readonly spoByPoolId: Maybe<Spo>;
  /** Get composite SPO data (identity + metadata + performance). */
  readonly spoCompositeByPoolId: Maybe<SpoComposite>;
  /** Get total count of SPOs. */
  readonly spoCount: Maybe<Scalars['Int']['output']>;
  /** List SPO identities with pagination. */
  readonly spoIdentities: ReadonlyArray<SpoIdentity>;
  /** Get SPO identity by pool ID. */
  readonly spoIdentityByPoolId: Maybe<SpoIdentity>;
  /** List SPOs with optional search. */
  readonly spoList: ReadonlyArray<Spo>;
  /** Get SPO performance by SPO key. */
  readonly spoPerformanceBySpoSk: ReadonlyArray<EpochPerf>;
  /** Get latest SPO performance entries. */
  readonly spoPerformanceLatest: ReadonlyArray<EpochPerf>;
  /** Get stake distribution with search and ordering. */
  readonly stakeDistribution: ReadonlyArray<StakeShare>;
  /** Get SPO identifiers ordered by performance. */
  readonly stakePoolOperators: ReadonlyArray<Scalars['String']['output']>;
  /** Get the full history of Terms and Conditions changes for governance auditability. */
  readonly termsAndConditionsHistory: ReadonlyArray<TermsAndConditionsChange>;
  /** Find transactions for the given offset. */
  readonly transactions: ReadonlyArray<Transaction>;
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
  cardanoRewardAddresses: ReadonlyArray<Scalars['CardanoRewardAddress']['input']>;
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
  readonly dparam: Maybe<Scalars['Float']['output']>;
  readonly epochNo: Scalars['Int']['output'];
  readonly federatedInvalidCount: Scalars['Int']['output'];
  readonly federatedValidCount: Scalars['Int']['output'];
  readonly registeredInvalidCount: Scalars['Int']['output'];
  readonly registeredValidCount: Scalars['Int']['output'];
};

/** Cumulative registration totals for an epoch. */
export type RegisteredTotals = {
  readonly epochNo: Scalars['Int']['output'];
  readonly newlyRegistered: Scalars['Int']['output'];
  readonly totalRegistered: Scalars['Int']['output'];
};

/** A regular Midnight transaction. */
export type RegularTransaction = Transaction & {
  /** The block for this transaction. */
  readonly block: Block;
  /** The contract actions for this transaction. */
  readonly contractActions: ReadonlyArray<ContractAction>;
  /** Dust ledger events of this transaction. */
  readonly dustLedgerEvents: ReadonlyArray<DustLedgerEvent>;
  /** The zswap state end index. */
  readonly endIndex: Scalars['Int']['output'];
  /** Fee information for this transaction. */
  readonly fees: TransactionFees;
  /** The hex-encoded transaction hash. */
  readonly hash: Scalars['HexEncoded']['output'];
  /** The transaction ID. */
  readonly id: Scalars['Int']['output'];
  /** The hex-encoded serialized transaction identifiers. */
  readonly identifiers: ReadonlyArray<Scalars['HexEncoded']['output']>;
  /** The hex-encoded serialized merkle-tree root. */
  readonly merkleTreeRoot: Scalars['HexEncoded']['output'];
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized transaction content. */
  readonly raw: Scalars['HexEncoded']['output'];
  /** The zswap state start index. */
  readonly startIndex: Scalars['Int']['output'];
  /** The result of applying this transaction to the ledger state. */
  readonly transactionResult: TransactionResult;
  /** Unshielded UTXOs created by this transaction. */
  readonly unshieldedCreatedOutputs: ReadonlyArray<UnshieldedUtxo>;
  /** Unshielded UTXOs spent (consumed) by this transaction. */
  readonly unshieldedSpentOutputs: ReadonlyArray<UnshieldedUtxo>;
  /** Zswap ledger events of this transaction. */
  readonly zswapLedgerEvents: ReadonlyArray<ZswapLedgerEvent>;
};

/** A transaction relevant for the subscribing wallet and an optional collapsed merkle tree. */
export type RelevantTransaction = {
  /** An optional collapsed merkle tree. */
  readonly collapsedMerkleTree: Maybe<CollapsedMerkleTree>;
  /** A transaction relevant for the subscribing wallet. */
  readonly transaction: RegularTransaction;
};

/**
 * One of many segments for a partially successful transaction result showing success for some
 * segment.
 */
export type Segment = {
  /** Segment ID. */
  readonly id: Scalars['Int']['output'];
  /** Successful or not. */
  readonly success: Scalars['Boolean']['output'];
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
  readonly highestCheckedEndIndex: Scalars['Int']['output'];
  /**
   * The highest zswap state end index (see `endIndex` of `Transaction`) of all transactions. It
   * represents the known state of the blockchain. A value of zero (completely unlikely) means
   * that no shielded transactions have been indexed yet.
   */
  readonly highestEndIndex: Scalars['Int']['output'];
  /**
   * The highest zswap state end index (see `endIndex` of `Transaction`) of all relevant
   * transactions for the subscribing wallet. Usually less than `highest_checked_end_index`
   * unless the latest checked transaction is relevant for the subscribing wallet. A value of
   * zero means that no relevant transactions have been indexed for the subscribing wallet.
   */
  readonly highestRelevantEndIndex: Scalars['Int']['output'];
};

/** SPO with optional metadata. */
export type Spo = {
  readonly auraPubkeyHex: Maybe<Scalars['String']['output']>;
  readonly homepageUrl: Maybe<Scalars['String']['output']>;
  readonly logoUrl: Maybe<Scalars['String']['output']>;
  readonly name: Maybe<Scalars['String']['output']>;
  readonly poolIdHex: Scalars['String']['output'];
  readonly sidechainPubkeyHex: Scalars['String']['output'];
  readonly ticker: Maybe<Scalars['String']['output']>;
  readonly validatorClass: Scalars['String']['output'];
};

/** Composite SPO data (identity + metadata + performance). */
export type SpoComposite = {
  readonly identity: Maybe<SpoIdentity>;
  readonly metadata: Maybe<PoolMetadata>;
  readonly performance: ReadonlyArray<EpochPerf>;
};

/** SPO identity information. */
export type SpoIdentity = {
  readonly auraPubkeyHex: Maybe<Scalars['String']['output']>;
  readonly mainchainPubkeyHex: Scalars['String']['output'];
  readonly poolIdHex: Scalars['String']['output'];
  readonly sidechainPubkeyHex: Scalars['String']['output'];
  readonly validatorClass: Scalars['String']['output'];
};

/**
 * Stake share information for an SPO.
 *
 * Values are sourced from mainchain pool data (e.g., Blockfrost) and keyed by Cardano pool_id.
 */
export type StakeShare = {
  /** Current active stake in lovelace. */
  readonly activeStake: Maybe<Scalars['String']['output']>;
  /** Declared pledge in lovelace. */
  readonly declaredPledge: Maybe<Scalars['String']['output']>;
  /** Pool homepage URL from metadata. */
  readonly homepageUrl: Maybe<Scalars['String']['output']>;
  /** Number of live delegators. */
  readonly liveDelegators: Maybe<Scalars['Int']['output']>;
  /** Current live pledge in lovelace. */
  readonly livePledge: Maybe<Scalars['String']['output']>;
  /** Saturation ratio (0.0 to 1.0+). */
  readonly liveSaturation: Maybe<Scalars['Float']['output']>;
  /** Current live stake in lovelace. */
  readonly liveStake: Maybe<Scalars['String']['output']>;
  /** Pool logo URL from metadata. */
  readonly logoUrl: Maybe<Scalars['String']['output']>;
  /** Pool name from metadata. */
  readonly name: Maybe<Scalars['String']['output']>;
  /** Cardano pool ID (56-character hex string). */
  readonly poolIdHex: Scalars['String']['output'];
  /** Stake share as a fraction of total stake. */
  readonly stakeShare: Maybe<Scalars['Float']['output']>;
  /** Pool ticker from metadata. */
  readonly ticker: Maybe<Scalars['String']['output']>;
};

export type Subscription = {
  /**
   * Subscribe to blocks starting at the given offset or at the latest block if the offset is
   * omitted.
   */
  readonly blocks: Block;
  /**
   * Subscribe to contract actions with the given address starting at the given offset or at the
   * latest block if the offset is omitted.
   */
  readonly contractActions: ContractAction;
  /** Subscribe to dust ledger events starting at the given ID or at the very start if omitted. */
  readonly dustLedgerEvents: DustLedgerEvent;
  /**
   * Subscribe to shielded transaction events for the given session ID starting at the given
   * index or at zero if omitted.
   */
  readonly shieldedTransactions: ShieldedTransactionsEvent;
  /**
   * Subscribe unshielded transaction events for the given address and the given transaction ID
   * or zero if omitted.
   */
  readonly unshieldedTransactions: UnshieldedTransactionsEvent;
  /** Subscribe to zswap ledger events starting at the given ID or at the very start if omitted. */
  readonly zswapLedgerEvents: ZswapLedgerEvent;
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
  readonly dParameter: DParameter;
  /** The current Terms and Conditions, if any have been set. */
  readonly termsAndConditions: Maybe<TermsAndConditions>;
};

/** A system Midnight transaction. */
export type SystemTransaction = Transaction & {
  /** The block for this transaction. */
  readonly block: Block;
  /** The contract actions for this transaction. */
  readonly contractActions: ReadonlyArray<ContractAction>;
  /** Dust ledger events of this transaction. */
  readonly dustLedgerEvents: ReadonlyArray<DustLedgerEvent>;
  /** The hex-encoded transaction hash. */
  readonly hash: Scalars['HexEncoded']['output'];
  /** The transaction ID. */
  readonly id: Scalars['Int']['output'];
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized transaction content. */
  readonly raw: Scalars['HexEncoded']['output'];
  /** Unshielded UTXOs created by this transaction. */
  readonly unshieldedCreatedOutputs: ReadonlyArray<UnshieldedUtxo>;
  /** Unshielded UTXOs spent (consumed) by this transaction. */
  readonly unshieldedSpentOutputs: ReadonlyArray<UnshieldedUtxo>;
  /** Zswap ledger events of this transaction. */
  readonly zswapLedgerEvents: ReadonlyArray<ZswapLedgerEvent>;
};

/** Terms and Conditions agreement. */
export type TermsAndConditions = {
  /** The hex-encoded hash of the Terms and Conditions document. */
  readonly hash: Scalars['HexEncoded']['output'];
  /** The URL where the Terms and Conditions can be found. */
  readonly url: Scalars['String']['output'];
};

/** Terms and Conditions change record for history queries. */
export type TermsAndConditionsChange = {
  /** The hex-encoded block hash where this T&C version became effective. */
  readonly blockHash: Scalars['HexEncoded']['output'];
  /** The block height where this T&C version became effective. */
  readonly blockHeight: Scalars['Int']['output'];
  /** The hex-encoded hash of the Terms and Conditions document. */
  readonly hash: Scalars['HexEncoded']['output'];
  /** The UNIX timestamp when this T&C version became effective. */
  readonly timestamp: Scalars['Int']['output'];
  /** The URL where the Terms and Conditions can be found. */
  readonly url: Scalars['String']['output'];
};

/** A Midnight transaction. */
export type Transaction = {
  readonly block: Block;
  readonly contractActions: ReadonlyArray<ContractAction>;
  readonly dustLedgerEvents: ReadonlyArray<DustLedgerEvent>;
  readonly hash: Scalars['HexEncoded']['output'];
  readonly id: Scalars['Int']['output'];
  readonly protocolVersion: Scalars['Int']['output'];
  readonly raw: Scalars['HexEncoded']['output'];
  readonly unshieldedCreatedOutputs: ReadonlyArray<UnshieldedUtxo>;
  readonly unshieldedSpentOutputs: ReadonlyArray<UnshieldedUtxo>;
  readonly zswapLedgerEvents: ReadonlyArray<ZswapLedgerEvent>;
};

/** Fees information for a transaction, including both paid and estimated fees. */
export type TransactionFees = {
  /** The estimated fees that was calculated for this transaction in DUST. */
  readonly estimatedFees: Scalars['String']['output'];
  /** The actual fees paid for this transaction in DUST. */
  readonly paidFees: Scalars['String']['output'];
};

/** Either a transaction hash or a transaction identifier. */
export type TransactionOffset =
  /** A hex-encoded transaction hash. */
  { readonly hash: Scalars['HexEncoded']['input']; readonly identifier?: never; }
  |  /** A hex-encoded transaction identifier. */
  { readonly hash?: never; readonly identifier: Scalars['HexEncoded']['input']; };

/**
 * The result of applying a transaction to the ledger state. In case of a partial success (status),
 * there will be segments.
 */
export type TransactionResult = {
  readonly segments: Maybe<ReadonlyArray<Segment>>;
  readonly status: TransactionResultStatus;
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
  readonly createdUtxos: ReadonlyArray<UnshieldedUtxo>;
  /** UTXOs spent in the above transaction, possibly empty. */
  readonly spentUtxos: ReadonlyArray<UnshieldedUtxo>;
  /** The transaction that created and/or spent UTXOs. */
  readonly transaction: Transaction;
};

/** An event of the unshielded transactions subscription. */
export type UnshieldedTransactionsEvent = UnshieldedTransaction | UnshieldedTransactionsProgress;

/** Information about the unshielded indexing progress. */
export type UnshieldedTransactionsProgress = {
  /** The highest transaction ID of all currently known transactions for a subscribed address. */
  readonly highestTransactionId: Scalars['Int']['output'];
};

/** Represents an unshielded UTXO. */
export type UnshieldedUtxo = {
  /** Transaction that created this UTXO. */
  readonly createdAtTransaction: Transaction;
  /** The creation time in seconds. */
  readonly ctime: Maybe<Scalars['Int']['output']>;
  /** The hex-encoded initial nonce for DUST generation tracking. */
  readonly initialNonce: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized intent hash. */
  readonly intentHash: Scalars['HexEncoded']['output'];
  /** Index of this output within its creating transaction. */
  readonly outputIndex: Scalars['Int']['output'];
  /** Owner Bech32m-encoded address. */
  readonly owner: Scalars['UnshieldedAddress']['output'];
  /** Whether this UTXO is registered for DUST generation. */
  readonly registeredForDustGeneration: Scalars['Boolean']['output'];
  /** Transaction that spent this UTXO. */
  readonly spentAtTransaction: Maybe<Transaction>;
  /** Token hex-encoded serialized token type. */
  readonly tokenType: Scalars['HexEncoded']['output'];
  /** UTXO value (quantity) as a string to support u128. */
  readonly value: Scalars['String']['output'];
};

/** A zswap related ledger event. */
export type ZswapLedgerEvent = {
  /** The ID of this zswap ledger event. */
  readonly id: Scalars['Int']['output'];
  /** The maximum ID of all zswap ledger events. */
  readonly maxId: Scalars['Int']['output'];
  /** The protocol version. */
  readonly protocolVersion: Scalars['Int']['output'];
  /** The hex-encoded serialized event. */
  readonly raw: Scalars['HexEncoded']['output'];
};

export type BlockHashQueryVariables = Exact<{
  offset: InputMaybe<BlockOffset>;
}>;


export type BlockHashQuery = { readonly block: { readonly height: number, readonly hash: string, readonly ledgerParameters: string, readonly timestamp: number } | null };

export type ConnectMutationVariables = Exact<{
  viewingKey: Scalars['ViewingKey']['input'];
}>;


export type ConnectMutation = { readonly connect: string };

export type DisconnectMutationVariables = Exact<{
  sessionId: Scalars['HexEncoded']['input'];
}>;


export type DisconnectMutation = { readonly disconnect: null };

export type FetchTermsAndConditionsQueryVariables = Exact<{ [key: string]: never; }>;


export type FetchTermsAndConditionsQuery = { readonly block: { readonly systemParameters: { readonly termsAndConditions: { readonly hash: string, readonly url: string } | null } } | null };

export type TransactionStatusQueryVariables = Exact<{
  transactionId: Scalars['HexEncoded']['input'];
}>;


export type TransactionStatusQuery = { readonly transactions: ReadonlyArray<
    | { readonly __typename: 'RegularTransaction', readonly identifiers: ReadonlyArray<string>, readonly transactionResult: { readonly __typename: 'TransactionResult', readonly status: TransactionResultStatus, readonly segments: ReadonlyArray<{ readonly id: number, readonly success: boolean }> | null } }
    | { readonly __typename: 'SystemTransaction' }
  > };

export type DustLedgerEventsSubscriptionVariables = Exact<{
  id: InputMaybe<Scalars['Int']['input']>;
}>;


export type DustLedgerEventsSubscription = { readonly dustLedgerEvents:
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'DustGenerationDtimeUpdate' }
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'DustInitialUtxo' }
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'DustSpendProcessed' }
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'ParamChange' }
   };

export type ShieldedTransactionsSubscriptionVariables = Exact<{
  sessionId: Scalars['HexEncoded']['input'];
  index: InputMaybe<Scalars['Int']['input']>;
}>;


export type ShieldedTransactionsSubscription = { readonly shieldedTransactions:
    | { readonly __typename: 'RelevantTransaction', readonly transaction: { readonly id: number, readonly raw: string, readonly hash: string, readonly protocolVersion: number, readonly identifiers: ReadonlyArray<string>, readonly startIndex: number, readonly endIndex: number, readonly fees: { readonly paidFees: string, readonly estimatedFees: string }, readonly transactionResult: { readonly status: TransactionResultStatus, readonly segments: ReadonlyArray<{ readonly id: number, readonly success: boolean }> | null } }, readonly collapsedMerkleTree: { readonly startIndex: number, readonly endIndex: number, readonly update: string, readonly protocolVersion: number } | null }
    | { readonly __typename: 'ShieldedTransactionsProgress', readonly highestEndIndex: number, readonly highestCheckedEndIndex: number, readonly highestRelevantEndIndex: number }
   };

export type UnshieldedTransactionsSubscriptionVariables = Exact<{
  address: Scalars['UnshieldedAddress']['input'];
  transactionId: InputMaybe<Scalars['Int']['input']>;
}>;


export type UnshieldedTransactionsSubscription = { readonly unshieldedTransactions:
    | { readonly type: 'UnshieldedTransaction', readonly transaction:
        | { readonly identifiers: ReadonlyArray<string>, readonly id: number, readonly hash: string, readonly protocolVersion: number, readonly type: 'RegularTransaction', readonly fees: { readonly paidFees: string, readonly estimatedFees: string }, readonly transactionResult: { readonly status: TransactionResultStatus, readonly segments: ReadonlyArray<{ readonly id: number, readonly success: boolean }> | null }, readonly block: { readonly timestamp: number } }
        | { readonly id: number, readonly hash: string, readonly protocolVersion: number, readonly type: 'SystemTransaction', readonly block: { readonly timestamp: number } }
      , readonly createdUtxos: ReadonlyArray<{ readonly owner: string, readonly tokenType: string, readonly value: string, readonly outputIndex: number, readonly intentHash: string, readonly ctime: number | null, readonly registeredForDustGeneration: boolean }>, readonly spentUtxos: ReadonlyArray<{ readonly owner: string, readonly tokenType: string, readonly value: string, readonly outputIndex: number, readonly intentHash: string, readonly ctime: number | null, readonly registeredForDustGeneration: boolean }> }
    | { readonly highestTransactionId: number, readonly type: 'UnshieldedTransactionsProgress' }
   };

export type ZswapEventsSubscriptionVariables = Exact<{
  id: InputMaybe<Scalars['Int']['input']>;
}>;


export type ZswapEventsSubscription = { readonly zswapLedgerEvents: { readonly id: number, readonly raw: string, readonly maxId: number } };


export const BlockHashDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BlockHash"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BlockOffset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"block"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"ledgerParameters"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<BlockHashQuery, BlockHashQueryVariables>;
export const ConnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Connect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ViewingKey"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"viewingKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}}}]}]}}]} as unknown as DocumentNode<ConnectMutation, ConnectMutationVariables>;
export const DisconnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Disconnect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disconnect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}]}]}}]} as unknown as DocumentNode<DisconnectMutation, DisconnectMutationVariables>;
export const FetchTermsAndConditionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FetchTermsAndConditions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"systemParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"termsAndConditions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}}]} as unknown as DocumentNode<FetchTermsAndConditionsQuery, FetchTermsAndConditionsQueryVariables>;
export const TransactionStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TransactionStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]}}]}}]} as unknown as DocumentNode<TransactionStatusQuery, TransactionStatusQueryVariables>;
export const DustLedgerEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"DustLedgerEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dustLedgerEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"maxId"}}]}}]}}]} as unknown as DocumentNode<DustLedgerEventsSubscription, DustLedgerEventsSubscriptionVariables>;
export const ShieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ShieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"index"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"index"},"value":{"kind":"Variable","name":{"kind":"Name","value":"index"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ShieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"highestEndIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestCheckedEndIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestRelevantEndIndex"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RelevantTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"startIndex"}},{"kind":"Field","name":{"kind":"Name","value":"endIndex"}},{"kind":"Field","name":{"kind":"Name","value":"fees"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paidFees"}},{"kind":"Field","name":{"kind":"Name","value":"estimatedFees"}}]}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"collapsedMerkleTree"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startIndex"}},{"kind":"Field","name":{"kind":"Name","value":"endIndex"}},{"kind":"Field","name":{"kind":"Name","value":"update"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ShieldedTransactionsSubscription, ShieldedTransactionsSubscriptionVariables>;
export const UnshieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"UnshieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"address"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedAddress"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unshieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"address"},"value":{"kind":"Variable","name":{"kind":"Name","value":"address"}}},{"kind":"Argument","name":{"kind":"Name","value":"transactionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"fees"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paidFees"}},{"kind":"Field","name":{"kind":"Name","value":"estimatedFees"}}]}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}},{"kind":"Field","name":{"kind":"Name","value":"ctime"}},{"kind":"Field","name":{"kind":"Name","value":"registeredForDustGeneration"}}]}},{"kind":"Field","name":{"kind":"Name","value":"spentUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}},{"kind":"Field","name":{"kind":"Name","value":"ctime"}},{"kind":"Field","name":{"kind":"Name","value":"registeredForDustGeneration"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"highestTransactionId"}}]}}]}}]}}]} as unknown as DocumentNode<UnshieldedTransactionsSubscription, UnshieldedTransactionsSubscriptionVariables>;
export const ZswapEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ZswapEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"zswapLedgerEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"maxId"}}]}}]}}]} as unknown as DocumentNode<ZswapEventsSubscription, ZswapEventsSubscriptionVariables>;