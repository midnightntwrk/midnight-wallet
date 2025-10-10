import { Subscription } from '../../effect/index.js';
import { gql } from '../generated/index.js';

export const UnshieldedTransactions = Subscription.make(
  'UnshieldedTransactions',
  gql(`
    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {
      unshieldedTransactions(address: $address, transactionId: $transactionId) {
        ... on UnshieldedTransaction {
          type: __typename
          transaction {
            type: __typename
            id
            hash
            protocolVersion
            ... on RegularTransaction {
              identifiers
              transactionResult {
                status
                segments {
                  id
                  success
                }
              }
            }
          }
          createdUtxos {
            owner
            tokenType
            value
            outputIndex
            intentHash
            registeredForDustGeneration
          }
          spentUtxos {
            owner
            tokenType
            value
            outputIndex
            intentHash
            registeredForDustGeneration
          }
        }
        ... on UnshieldedTransactionsProgress {
          type: __typename
          highestTransactionId
        }
      }
    }
  `),
);
