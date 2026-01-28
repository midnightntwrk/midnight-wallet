import { gql } from '../generated/index.js';
import { Query } from '../../effect/index.js';

export const TransactionStatus = Query.make(
  'TransactionStatus',
  gql(`
    query TransactionStatus($transactionId: HexEncoded!) {
      transactions(offset: {identifier: $transactionId}) {
        __typename
        ... on RegularTransaction {
          identifiers
          transactionResult {
            segments {
              id
              success
            }
            status
            __typename
          }
        }
      }
    }
  `),
);
