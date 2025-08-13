import { Subscription } from '../../effect';
import { gql } from '../generated';

export const ShieldedTransactions = Subscription.make(
  'ShieldedTransactions',
  gql(`
    subscription ShieldedTransactions($sessionId: HexEncoded!, $index: Int, $sendProgressUpdates: Boolean) {
      shieldedTransactions(sessionId: $sessionId, index: $index, sendProgressUpdates: $sendProgressUpdates) {
        __typename
        ... on ShieldedTransactionsProgress {
          highestIndex
          highestRelevantIndex
          highestRelevantWalletIndex
        }
        ... on ViewingUpdate {
          index
          update {
            ... on MerkleTreeCollapsedUpdate {
              update
              protocolVersion
            }
            ... on RelevantTransaction {
              transaction {
                hash
                protocolVersion
                transactionResult {
                  status
                }
              }
            }
          }
        }
      }
    }
  `),
);
