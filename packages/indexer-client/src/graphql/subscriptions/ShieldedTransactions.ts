import { Subscription } from '../../effect';
import { gql } from '../generated';

export const ShieldedTransactions = Subscription.make(
  'ShieldedTransactions',
  gql(`
    subscription ShieldedTransactions($sessionId: HexEncoded!, $index: Int) {
      shieldedTransactions(sessionId: $sessionId, index: $index) {
        __typename
        ... on ShieldedTransactionsProgress {
          highestEndIndex
          highestCheckedEndIndex
          highestRelevantEndIndex
        }
        ... on RelevantTransaction {
          transaction {
            id
            raw
            hash
            protocolVersion
            identifiers
            startIndex
            endIndex
            fees {
              paidFees
              estimatedFees
            }
            transactionResult {
              status
              segments {
                id
                success
              }
            }
          }
          collapsedMerkleTree {
            startIndex
            endIndex
            update
            protocolVersion
          }
        }
      }
    }
  `),
);
