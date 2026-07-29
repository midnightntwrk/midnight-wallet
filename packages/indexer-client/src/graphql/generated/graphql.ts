/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
/** Either a block hash or a block height. */
export type BlockOffset =
  {   /** A hex-encoded block hash. */
  readonly hash: string; readonly height?: never; }
  |  { readonly hash?: never;   /** A block height. */
  readonly height: number; };

/** The status of the transaction result: success, partial success or failure. */
export type TransactionResultStatus =
  | 'FAILURE'
  | 'PARTIAL_SUCCESS'
  | 'SUCCESS'
  | '%future added value';

export type BlockHashQueryVariables = Exact<{
  offset: BlockOffset | null | undefined;
}>;


export type BlockHashQuery = { readonly block: { readonly height: number, readonly hash: string, readonly ledgerParameters: string, readonly timestamp: number } | null };

export type ConnectMutationVariables = Exact<{
  viewingKey: string;
}>;


export type ConnectMutation = { readonly connect: string };

export type DisconnectMutationVariables = Exact<{
  sessionId: string;
}>;


export type DisconnectMutation = { readonly disconnect: null };

export type FetchTermsAndConditionsQueryVariables = Exact<{ [key: string]: never; }>;


export type FetchTermsAndConditionsQuery = { readonly block: { readonly systemParameters: { readonly termsAndConditions: { readonly hash: string, readonly url: string } | null } } | null };

export type TransactionHistoryDetailQueryVariables = Exact<{
  transactionHash: string;
}>;


export type TransactionHistoryDetailQuery = { readonly transactions: ReadonlyArray<
    | { readonly __typename: 'RegularTransaction', readonly identifiers: ReadonlyArray<string>, readonly hash: string, readonly fees: { readonly paidFees: string }, readonly transactionResult: { readonly status: TransactionResultStatus }, readonly block: { readonly hash: string, readonly height: number, readonly timestamp: number } }
    | { readonly __typename: 'SystemTransaction', readonly hash: string, readonly block: { readonly hash: string, readonly height: number, readonly timestamp: number } }
  > };

export type TransactionStatusQueryVariables = Exact<{
  transactionId: string;
}>;


export type TransactionStatusQuery = { readonly transactions: ReadonlyArray<
    | { readonly __typename: 'RegularTransaction', readonly identifiers: ReadonlyArray<string>, readonly transactionResult: { readonly __typename: 'TransactionResult', readonly status: TransactionResultStatus, readonly segments: ReadonlyArray<{ readonly id: number, readonly success: boolean }> | null } }
    | { readonly __typename: 'SystemTransaction' }
  > };

export type DustLedgerEventsSubscriptionVariables = Exact<{
  id: number | null | undefined;
}>;


export type DustLedgerEventsSubscription = { readonly dustLedgerEvents:
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'DustGenerationDtimeUpdate' }
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'DustInitialUtxo' }
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'DustSpendProcessed' }
    | { readonly id: number, readonly raw: string, readonly maxId: number, readonly type: 'ParamChange' }
   };

export type ShieldedTransactionsSubscriptionVariables = Exact<{
  sessionId: string;
  index: number | null | undefined;
}>;


export type ShieldedTransactionsSubscription = { readonly shieldedTransactions:
    | { readonly __typename: 'RelevantTransaction', readonly transaction: { readonly id: number, readonly raw: string, readonly hash: string, readonly protocolVersion: number, readonly identifiers: ReadonlyArray<string>, readonly startIndex: number, readonly endIndex: number, readonly fees: { readonly paidFees: string, readonly estimatedFees: string }, readonly transactionResult: { readonly status: TransactionResultStatus, readonly segments: ReadonlyArray<{ readonly id: number, readonly success: boolean }> | null } }, readonly collapsedMerkleTree: { readonly startIndex: number, readonly endIndex: number, readonly update: string, readonly protocolVersion: number } | null }
    | { readonly __typename: 'ShieldedTransactionsProgress', readonly highestEndIndex: number, readonly highestCheckedEndIndex: number, readonly highestRelevantEndIndex: number }
   };

export type UnshieldedTransactionsSubscriptionVariables = Exact<{
  address: string;
  transactionId: number | null | undefined;
}>;


export type UnshieldedTransactionsSubscription = { readonly unshieldedTransactions:
    | { readonly type: 'UnshieldedTransaction', readonly transaction:
        | { readonly identifiers: ReadonlyArray<string>, readonly id: number, readonly hash: string, readonly protocolVersion: number, readonly type: 'RegularTransaction', readonly fees: { readonly paidFees: string, readonly estimatedFees: string }, readonly transactionResult: { readonly status: TransactionResultStatus, readonly segments: ReadonlyArray<{ readonly id: number, readonly success: boolean }> | null }, readonly block: { readonly hash: string, readonly height: number, readonly timestamp: number } }
        | { readonly id: number, readonly hash: string, readonly protocolVersion: number, readonly type: 'SystemTransaction', readonly block: { readonly hash: string, readonly height: number, readonly timestamp: number } }
      , readonly createdUtxos: ReadonlyArray<{ readonly owner: string, readonly tokenType: string, readonly value: string, readonly outputIndex: number, readonly intentHash: string, readonly ctime: number | null, readonly registeredForDustGeneration: boolean }>, readonly spentUtxos: ReadonlyArray<{ readonly owner: string, readonly tokenType: string, readonly value: string, readonly outputIndex: number, readonly intentHash: string, readonly ctime: number | null, readonly registeredForDustGeneration: boolean }> }
    | { readonly highestTransactionId: number, readonly type: 'UnshieldedTransactionsProgress' }
   };

export type ZswapEventsSubscriptionVariables = Exact<{
  id: number | null | undefined;
}>;


export type ZswapEventsSubscription = { readonly zswapLedgerEvents: { readonly id: number, readonly raw: string, readonly protocolVersion: number, readonly maxId: number } };


export const BlockHashDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BlockHash"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"BlockOffset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"block"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"ledgerParameters"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<BlockHashQuery, BlockHashQueryVariables>;
export const ConnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Connect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ViewingKey"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"viewingKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"viewingKey"}}}]}]}}]} as unknown as DocumentNode<ConnectMutation, ConnectMutationVariables>;
export const DisconnectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Disconnect"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disconnect"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}]}]}}]} as unknown as DocumentNode<DisconnectMutation, DisconnectMutationVariables>;
export const FetchTermsAndConditionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FetchTermsAndConditions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"systemParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"termsAndConditions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}}]} as unknown as DocumentNode<FetchTermsAndConditionsQuery, FetchTermsAndConditionsQueryVariables>;
export const TransactionHistoryDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TransactionHistoryDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionHash"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"hash"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionHash"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"fees"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paidFees"}}]}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}}]} as unknown as DocumentNode<TransactionHistoryDetailQuery, TransactionHistoryDetailQueryVariables>;
export const TransactionStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TransactionStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]}}]}}]} as unknown as DocumentNode<TransactionStatusQuery, TransactionStatusQueryVariables>;
export const DustLedgerEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"DustLedgerEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"dustLedgerEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"maxId"}}]}}]}}]} as unknown as DocumentNode<DustLedgerEventsSubscription, DustLedgerEventsSubscriptionVariables>;
export const ShieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ShieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"HexEncoded"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"index"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"index"},"value":{"kind":"Variable","name":{"kind":"Name","value":"index"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ShieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"highestEndIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestCheckedEndIndex"}},{"kind":"Field","name":{"kind":"Name","value":"highestRelevantEndIndex"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RelevantTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"startIndex"}},{"kind":"Field","name":{"kind":"Name","value":"endIndex"}},{"kind":"Field","name":{"kind":"Name","value":"fees"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paidFees"}},{"kind":"Field","name":{"kind":"Name","value":"estimatedFees"}}]}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"collapsedMerkleTree"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startIndex"}},{"kind":"Field","name":{"kind":"Name","value":"endIndex"}},{"kind":"Field","name":{"kind":"Name","value":"update"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ShieldedTransactionsSubscription, ShieldedTransactionsSubscriptionVariables>;
export const UnshieldedTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"UnshieldedTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"address"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedAddress"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unshieldedTransactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"address"},"value":{"kind":"Variable","name":{"kind":"Name","value":"address"}}},{"kind":"Argument","name":{"kind":"Name","value":"transactionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegularTransaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifiers"}},{"kind":"Field","name":{"kind":"Name","value":"fees"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"paidFees"}},{"kind":"Field","name":{"kind":"Name","value":"estimatedFees"}}]}},{"kind":"Field","name":{"kind":"Name","value":"transactionResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"segments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}},{"kind":"Field","name":{"kind":"Name","value":"ctime"}},{"kind":"Field","name":{"kind":"Name","value":"registeredForDustGeneration"}}]}},{"kind":"Field","name":{"kind":"Name","value":"spentUtxos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"owner"}},{"kind":"Field","name":{"kind":"Name","value":"tokenType"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"outputIndex"}},{"kind":"Field","name":{"kind":"Name","value":"intentHash"}},{"kind":"Field","name":{"kind":"Name","value":"ctime"}},{"kind":"Field","name":{"kind":"Name","value":"registeredForDustGeneration"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UnshieldedTransactionsProgress"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"type"},"name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"highestTransactionId"}}]}}]}}]}}]} as unknown as DocumentNode<UnshieldedTransactionsSubscription, UnshieldedTransactionsSubscriptionVariables>;
export const ZswapEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ZswapEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"zswapLedgerEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"raw"}},{"kind":"Field","name":{"kind":"Name","value":"protocolVersion"}},{"kind":"Field","name":{"kind":"Name","value":"maxId"}}]}}]}}]} as unknown as DocumentNode<ZswapEventsSubscription, ZswapEventsSubscriptionVariables>;