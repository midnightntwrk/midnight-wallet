import { Subscription } from '../../effect';
import { gql } from '../generated';

export const UnshieldedTransactions = Subscription.make(
  'UnshieldedTransactions',
  gql(`
    subscription UnshieldedTransactions($address: UnshieldedAddress!, $transactionId: Int) {
      unshieldedTransactions(address: $address, transactionId: $transactionId) {
        ... on UnshieldedTransaction {
          type: __typename
          transaction {
            id
            hash
            protocolVersion
            identifiers
            transactionResult {
              status
              segments {
                id
                success
              }
            }
          }
          createdUtxos {
            owner
            tokenType
            value
            outputIndex
            intentHash
          }
          spentUtxos {
            owner
            tokenType
            value
            outputIndex
            intentHash
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
