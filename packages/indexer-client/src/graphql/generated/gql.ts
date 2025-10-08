/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n    query BlockHash($offset: BlockOffset) {\n      block(offset: $offset) {\n        height\n        hash\n      }\n    }\n  ": typeof types.BlockHashDocument,
    "\n    mutation Connect($viewingKey: ViewingKey!) {\n      connect(viewingKey: $viewingKey)\n    }\n  ": typeof types.ConnectDocument,
    "\n    mutation Disconnect($sessionId: HexEncoded!) {\n      disconnect(sessionId: $sessionId)\n    }\n  ": typeof types.DisconnectDocument,
    "\n    subscription DustLedgerEvents($id: Int) {\n      dustLedgerEvents(id: $id) {\n        type: __typename\n        id\n        raw\n        maxId\n      }\n    }\n  ": typeof types.DustLedgerEventsDocument,
    "\n    subscription ShieldedTransactions($sessionId: HexEncoded!, $index: Int) {\n      shieldedTransactions(sessionId: $sessionId, index: $index) {\n        __typename\n        ... on ShieldedTransactionsProgress {\n          highestEndIndex\n          highestCheckedEndIndex\n          highestRelevantEndIndex\n        }\n        ... on RelevantTransaction {\n          transaction {\n            id\n            raw\n            hash\n            protocolVersion\n            identifiers\n            startIndex\n            endIndex\n            fees {\n              paidFees\n              estimatedFees\n            }\n            transactionResult {\n              status\n              segments {\n                id\n                success\n              }\n            }\n          }\n          collapsedMerkleTree {\n            startIndex\n            endIndex\n            update\n            protocolVersion\n          }\n        }\n      }\n    }\n  ": typeof types.ShieldedTransactionsDocument,
    "\n    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {\n      unshieldedTransactions(address: $address, transactionId: $transactionId) {\n        ... on UnshieldedTransaction {\n          type: __typename\n          transaction {\n            id\n            hash\n            protocolVersion\n          }\n          createdUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n          spentUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n        }\n        ... on UnshieldedTransactionsProgress {\n          type: __typename\n          highestTransactionId\n        }\n      }\n    }\n  ": typeof types.UnshieldedTransactionsDocument,
    "\n    subscription ZswapEvents($id: Int) {\n      zswapLedgerEvents(id: $id) {\n        id\n        raw\n        maxId\n      }\n    }\n  ": typeof types.ZswapEventsDocument,
};
const documents: Documents = {
    "\n    query BlockHash($offset: BlockOffset) {\n      block(offset: $offset) {\n        height\n        hash\n      }\n    }\n  ": types.BlockHashDocument,
    "\n    mutation Connect($viewingKey: ViewingKey!) {\n      connect(viewingKey: $viewingKey)\n    }\n  ": types.ConnectDocument,
    "\n    mutation Disconnect($sessionId: HexEncoded!) {\n      disconnect(sessionId: $sessionId)\n    }\n  ": types.DisconnectDocument,
    "\n    subscription DustLedgerEvents($id: Int) {\n      dustLedgerEvents(id: $id) {\n        type: __typename\n        id\n        raw\n        maxId\n      }\n    }\n  ": types.DustLedgerEventsDocument,
    "\n    subscription ShieldedTransactions($sessionId: HexEncoded!, $index: Int) {\n      shieldedTransactions(sessionId: $sessionId, index: $index) {\n        __typename\n        ... on ShieldedTransactionsProgress {\n          highestEndIndex\n          highestCheckedEndIndex\n          highestRelevantEndIndex\n        }\n        ... on RelevantTransaction {\n          transaction {\n            id\n            raw\n            hash\n            protocolVersion\n            identifiers\n            startIndex\n            endIndex\n            fees {\n              paidFees\n              estimatedFees\n            }\n            transactionResult {\n              status\n              segments {\n                id\n                success\n              }\n            }\n          }\n          collapsedMerkleTree {\n            startIndex\n            endIndex\n            update\n            protocolVersion\n          }\n        }\n      }\n    }\n  ": types.ShieldedTransactionsDocument,
    "\n    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {\n      unshieldedTransactions(address: $address, transactionId: $transactionId) {\n        ... on UnshieldedTransaction {\n          type: __typename\n          transaction {\n            id\n            hash\n            protocolVersion\n          }\n          createdUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n          spentUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n        }\n        ... on UnshieldedTransactionsProgress {\n          type: __typename\n          highestTransactionId\n        }\n      }\n    }\n  ": types.UnshieldedTransactionsDocument,
    "\n    subscription ZswapEvents($id: Int) {\n      zswapLedgerEvents(id: $id) {\n        id\n        raw\n        maxId\n      }\n    }\n  ": types.ZswapEventsDocument,
};

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = gql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function gql(source: string): unknown;

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n    query BlockHash($offset: BlockOffset) {\n      block(offset: $offset) {\n        height\n        hash\n      }\n    }\n  "): (typeof documents)["\n    query BlockHash($offset: BlockOffset) {\n      block(offset: $offset) {\n        height\n        hash\n      }\n    }\n  "];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n    mutation Connect($viewingKey: ViewingKey!) {\n      connect(viewingKey: $viewingKey)\n    }\n  "): (typeof documents)["\n    mutation Connect($viewingKey: ViewingKey!) {\n      connect(viewingKey: $viewingKey)\n    }\n  "];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n    mutation Disconnect($sessionId: HexEncoded!) {\n      disconnect(sessionId: $sessionId)\n    }\n  "): (typeof documents)["\n    mutation Disconnect($sessionId: HexEncoded!) {\n      disconnect(sessionId: $sessionId)\n    }\n  "];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n    subscription DustLedgerEvents($id: Int) {\n      dustLedgerEvents(id: $id) {\n        type: __typename\n        id\n        raw\n        maxId\n      }\n    }\n  "): (typeof documents)["\n    subscription DustLedgerEvents($id: Int) {\n      dustLedgerEvents(id: $id) {\n        type: __typename\n        id\n        raw\n        maxId\n      }\n    }\n  "];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n    subscription ShieldedTransactions($sessionId: HexEncoded!, $index: Int) {\n      shieldedTransactions(sessionId: $sessionId, index: $index) {\n        __typename\n        ... on ShieldedTransactionsProgress {\n          highestEndIndex\n          highestCheckedEndIndex\n          highestRelevantEndIndex\n        }\n        ... on RelevantTransaction {\n          transaction {\n            id\n            raw\n            hash\n            protocolVersion\n            identifiers\n            startIndex\n            endIndex\n            fees {\n              paidFees\n              estimatedFees\n            }\n            transactionResult {\n              status\n              segments {\n                id\n                success\n              }\n            }\n          }\n          collapsedMerkleTree {\n            startIndex\n            endIndex\n            update\n            protocolVersion\n          }\n        }\n      }\n    }\n  "): (typeof documents)["\n    subscription ShieldedTransactions($sessionId: HexEncoded!, $index: Int) {\n      shieldedTransactions(sessionId: $sessionId, index: $index) {\n        __typename\n        ... on ShieldedTransactionsProgress {\n          highestEndIndex\n          highestCheckedEndIndex\n          highestRelevantEndIndex\n        }\n        ... on RelevantTransaction {\n          transaction {\n            id\n            raw\n            hash\n            protocolVersion\n            identifiers\n            startIndex\n            endIndex\n            fees {\n              paidFees\n              estimatedFees\n            }\n            transactionResult {\n              status\n              segments {\n                id\n                success\n              }\n            }\n          }\n          collapsedMerkleTree {\n            startIndex\n            endIndex\n            update\n            protocolVersion\n          }\n        }\n      }\n    }\n  "];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {\n      unshieldedTransactions(address: $address, transactionId: $transactionId) {\n        ... on UnshieldedTransaction {\n          type: __typename\n          transaction {\n            id\n            hash\n            protocolVersion\n          }\n          createdUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n          spentUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n        }\n        ... on UnshieldedTransactionsProgress {\n          type: __typename\n          highestTransactionId\n        }\n      }\n    }\n  "): (typeof documents)["\n    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {\n      unshieldedTransactions(address: $address, transactionId: $transactionId) {\n        ... on UnshieldedTransaction {\n          type: __typename\n          transaction {\n            id\n            hash\n            protocolVersion\n          }\n          createdUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n          spentUtxos {\n            owner\n            tokenType\n            value\n            outputIndex\n            intentHash\n            registeredForDustGeneration\n          }\n        }\n        ... on UnshieldedTransactionsProgress {\n          type: __typename\n          highestTransactionId\n        }\n      }\n    }\n  "];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "\n    subscription ZswapEvents($id: Int) {\n      zswapLedgerEvents(id: $id) {\n        id\n        raw\n        maxId\n      }\n    }\n  "): (typeof documents)["\n    subscription ZswapEvents($id: Int) {\n      zswapLedgerEvents(id: $id) {\n        id\n        raw\n        maxId\n      }\n    }\n  "];

export function gql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;