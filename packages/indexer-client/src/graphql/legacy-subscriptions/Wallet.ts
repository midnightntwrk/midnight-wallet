import { Subscription } from '../../effect';
import { gql } from '../generated';

export const Wallet = Subscription.make(
  'Wallet',
  gql(`
    subscription Wallet($sessionId: HexEncoded!, $index: Int) {
      wallet(sessionId: $sessionId, index: $index) {
        __typename
        ... on ProgressUpdate {
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
                raw
                # The following code will be required for Indexer ^3.0.0 (replacing the line that follows the comment)
                # transactionResult {
                #  status
                # }
                applyStage
                protocolVersion
              }
            }
          }
        }
      }
    }
  `),
);
