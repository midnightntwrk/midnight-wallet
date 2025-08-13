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
  ApplyStage: { input: string; output: string; }
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
  /** The parent of this block. */
  parent: Maybe<Block>;
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
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

/** A contract action. */
export type ContractAction = {
  address: Scalars['HexEncoded']['output'];
  chainState: Scalars['HexEncoded']['output'];
  state: Scalars['HexEncoded']['output'];
  transaction: Transaction;
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
  /** The hex-encoded serialized contract-specific zswap state. */
  chainState: Scalars['HexEncoded']['output'];
  deploy: ContractDeploy;
  /** The hex-encoded serialized entry point. */
  entryPoint: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized state. */
  state: Scalars['HexEncoded']['output'];
  transaction: Transaction;
  /** Unshielded token balances held by this contract. */
  unshieldedBalances: Array<ContractBalance>;
};

/** A contract deployment. */
export type ContractDeploy = ContractAction & {
  /** The hex-encoded serialized address. */
  address: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized contract-specific zswap state. */
  chainState: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized state. */
  state: Scalars['HexEncoded']['output'];
  transaction: Transaction;
  /**
   * Unshielded token balances held by this contract.
   * According to the architecture, deployed contracts must have zero balance.
   */
  unshieldedBalances: Array<ContractBalance>;
};

/** A contract update. */
export type ContractUpdate = ContractAction & {
  /** The hex-encoded serialized address. */
  address: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized contract-specific zswap state. */
  chainState: Scalars['HexEncoded']['output'];
  /** The hex-encoded serialized state. */
  state: Scalars['HexEncoded']['output'];
  transaction: Transaction;
  /** Unshielded token balances held by this contract after the update. */
  unshieldedBalances: Array<ContractBalance>;
};

export type MerkleTreeCollapsedUpdate = {
  /** The end index into the zswap state. */
  end: Scalars['Int']['output'];
  /** The protocol version. */
  protocolVersion: Scalars['Int']['output'];
  /** The start index into the zswap state. */
  start: Scalars['Int']['output'];
  /** The hex-encoded merkle-tree collapsed update. */
  update: Scalars['HexEncoded']['output'];
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

export type ProgressUpdate = {
  /** The highest end index into the zswap state of all currently known transactions. */
  highestIndex: Scalars['Int']['output'];
  /**
   * The highest end index into the zswap state of all currently known relevant transactions,
   * i.e. such that belong to any wallet. Less or equal `highest_index`.
   */
  highestRelevantIndex: Scalars['Int']['output'];
  /**
   * The highest end index into the zswap state of all currently known relevant transactions for
   * a particular wallet. Less or equal `highest_relevant_index`.
   */
  highestRelevantWalletIndex: Scalars['Int']['output'];
};

export type Query = {
  /** Find a block for the given optional offset; if not present, the latest block is returned. */
  block: Maybe<Block>;
  /** Find a contract action for the given address and optional offset. */
  contractAction: Maybe<ContractAction>;
  /** Find transactions for the given offset. */
  transactions: Array<Transaction>;
};


export type QueryBlockArgs = {
  offset: InputMaybe<BlockOffset>;
};


export type QueryContractActionArgs = {
  address: Scalars['HexEncoded']['input'];
  offset: InputMaybe<ContractActionOffset>;
};


export type QueryTransactionsArgs = {
  offset: TransactionOffset;
};

export type RelevantTransaction = {
  /** The end index. */
  end: Scalars['Int']['output'];
  /** The start index. */
  start: Scalars['Int']['output'];
  /** Relevant transaction for the wallet. */
  transaction: Transaction;
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
export type ShieldedTransactionsEvent = ShieldedTransactionsProgress | ViewingUpdate;

/** Aggregates information about the shielded transactions indexing progress. */
export type ShieldedTransactionsProgress = {
  /** The highest end index into the zswap state of all currently known transactions. */
  highestIndex: Scalars['Int']['output'];
  /**
   * The highest end index into the zswap state of all currently known relevant transactions,
   * i.e. those that belong to any known wallet. Less or equal `highest_index`.
   */
  highestRelevantIndex: Scalars['Int']['output'];
  /**
   * The highest end index into the zswap state of all currently known relevant transactions for
   * a particular wallet. Less or equal `highest_relevant_index`.
   */
  highestRelevantWalletIndex: Scalars['Int']['output'];
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
  /**
   * Subscribe shielded transaction events for the given session ID starting at the given index
   * or at zero if omitted.
   */
  shieldedTransactions: ShieldedTransactionsEvent;
  /**
   * Subscribe unshielded transaction events for the given address and the given transaction ID
   * or zero if omitted.
   */
  unshieldedTransactions: UnshieldedTransactionsEvent;
  /** Subscribe to wallet events. */
  wallet: WalletSyncEvent;
};


export type SubscriptionBlocksArgs = {
  offset: InputMaybe<BlockOffset>;
};


export type SubscriptionContractActionsArgs = {
  address: Scalars['HexEncoded']['input'];
  offset: InputMaybe<BlockOffset>;
};


export type SubscriptionShieldedTransactionsArgs = {
  index: InputMaybe<Scalars['Int']['input']>;
  sendProgressUpdates: InputMaybe<Scalars['Boolean']['input']>;
  sessionId: Scalars['HexEncoded']['input'];
};


export type SubscriptionUnshieldedTransactionsArgs = {
  address: Scalars['UnshieldedAddress']['input'];
  transactionId: InputMaybe<Scalars['Int']['input']>;
};


export type SubscriptionWalletArgs = {
  index: InputMaybe<Scalars['Int']['input']>;
  sendProgressUpdates: InputMaybe<Scalars['Boolean']['input']>;
  sessionId: Scalars['HexEncoded']['input'];
};

/** A transaction with its relevant data. */
export type Transaction = {
  /** The transaction apply stage. */
  applyStage: Scalars['ApplyStage']['output'];
  /** The block for this transaction. */
  block: Block;
  /** The contract actions. */
  contractActions: Array<ContractAction>;
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
  /** The result of applying a transaction to the ledger state. */
  transactionResult: TransactionResult;
  /** Unshielded UTXOs created by this transaction. */
  unshieldedCreatedOutputs: Array<UnshieldedUtxo>;
  /** Unshielded UTXOs spent (consumed) by this transaction. */
  unshieldedSpentOutputs: Array<UnshieldedUtxo>;
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
  /** The hex-encoded serialized intent hash. */
  intentHash: Scalars['HexEncoded']['output'];
  /** Index of this output within its creating transaction. */
  outputIndex: Scalars['Int']['output'];
  /** Owner Bech32m-encoded address. */
  owner: Scalars['UnshieldedAddress']['output'];
  /** Transaction that spent this UTXO. */
  spentAtTransaction: Maybe<Transaction>;
  /** Token hex-encoded serialized token type. */
  tokenType: Scalars['HexEncoded']['output'];
  /** UTXO value (quantity) as a string to support u128. */
  value: Scalars['String']['output'];
};

/**
 * Aggregates a relevant transaction with the next start index and an optional collapsed
 * Merkle-Tree update.
 */
export type ViewingUpdate = {
  /**
   * Next start index into the zswap state to be queried. Usually the end index of the included
   * relevant transaction plus one unless that is a failure in which case just its end
   * index.
   */
  index: Scalars['Int']['output'];
  /** Relevant transaction for the wallet and maybe a collapsed Merkle-Tree update. */
  update: Array<ZswapChainStateUpdate>;
};

export type WalletSyncEvent = ProgressUpdate | ViewingUpdate;

export type ZswapChainStateUpdate = MerkleTreeCollapsedUpdate | RelevantTransaction;

export type WalletSubscriptionVariables = Exact<{
  sessionId: Scalars['HexEncoded']['input'];
  index: InputMaybe<Scalars['Int']['input']>;
}>;


export type WalletSubscription = { wallet: { __typename: 'ProgressUpdate', highestIndex: number, highestRelevantIndex: number, highestRelevantWalletIndex: number } | { __typename: 'ViewingUpdate', index: number, update: Array<{ update: string, protocolVersion: number } | { transaction: { hash: string, raw: string, applyStage: string, protocolVersion: number } }> } };

export type BlockHashQueryVariables = Exact<{
  offset: InputMaybe<BlockOffset>;
}>;


export type BlockHashQuery = { block: { height: number, hash: string } | null };

export type ConnectMutationVariables = Exact<{
  viewingKey: Scalars['ViewingKey']['input'];
}>;


export type ConnectMutation = { connect: string };

export type DisconnectMutationVariables = Exact<{
  sessionId: Scalars['HexEncoded']['input'];
}>;


export type DisconnectMutation = { disconnect: null };

export type ShieldedTransactionsSubscriptionVariables = Exact<{
  sessionId: Scalars['HexEncoded']['input'];
  index: InputMaybe<Scalars['Int']['input']>;
  sendProgressUpdates: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type ShieldedTransactionsSubscription = { shieldedTransactions: { __typename: 'ShieldedTransactionsProgress', highestIndex: number, highestRelevantIndex: number, highestRelevantWalletIndex: number } | { __typename: 'ViewingUpdate', index: number, update: Array<{ update: string, protocolVersion: number } | { transaction: { hash: string, protocolVersion: number, transactionResult: { status: TransactionResultStatus } } }> } };

export type UnshieldedTransactionsSubscriptionVariables = Exact<{
  address: Scalars['UnshieldedAddress']['input'];
  transactionId: InputMaybe<Scalars['Int']['input']>;
}>;


export type UnshieldedTransactionsSubscription = { unshieldedTransactions: { type: 'UnshieldedTransaction', transaction: { id: number, hash: string, protocolVersion: number, identifiers: Array<string>, transactionResult: { status: TransactionResultStatus, segments: Array<{ id: number, success: boolean }> | null } }, createdUtxos: Array<{ owner: string, tokenType: string, value: string, outputIndex: number, intentHash: string }>, spentUtxos: Array<{ owner: string, tokenType: string, value: string, outputIndex: number, intentHash: string }> } | { highestTransactionId: number, type: 'UnshieldedTransactionsProgress' } };


export const WalletDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"Wallet"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"index"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wallet"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"index"},"value":{"kind":"Variable","name":{"kind":"Name","value":"index"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"highestIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestRelevantIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestRelevantWalletIndex"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewingUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"update"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MerkleTreeCollapsedUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"update"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RelevantTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"applyStage"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<WalletSubscription, WalletSubscriptionVariables>;
export const BlockHashDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BlockHash"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BlockOffset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"block"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}}]}}]}}]} as unknown as DocumentNode<BlockHashQuery, BlockHashQueryVariables>;
export const ConnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Connect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ViewingKey"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"viewingKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}}}]}]}}]} as unknown as DocumentNode<ConnectMutation, ConnectMutationVariables>;
export const DisconnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Disconnect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disconnect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}]}]}}]} as unknown as DocumentNode<DisconnectMutation, DisconnectMutationVariables>;
export const ShieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ShieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"index"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sendProgressUpdates"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"index"},"value":{"kind":"Variable","name":{"kind":"Name","value":"index"}}},{"kind":"Argument","name":{"kind":"Name","value":"sendProgressUpdates"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sendProgressUpdates"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ShieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"highestIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestRelevantIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestRelevantWalletIndex"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewingUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"update"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MerkleTreeCollapsedUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"update"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RelevantTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<ShieldedTransactionsSubscription, ShieldedTransactionsSubscriptionVariables>;
export const UnshieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"UnshieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"address"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedAddress"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unshieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"address"},"value":{"kind":"Variable","name":{"kind":"Name","value":"address"}}},{"kind":"Argument","name":{"kind":"Name","value":"transactionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}}]}},{"kind":"Field","name":{"kind":"Name","value":"spentUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"highestTransactionId"}}]}}]}}]}}]} as unknown as DocumentNode<UnshieldedTransactionsSubscription, UnshieldedTransactionsSubscriptionVariables>;