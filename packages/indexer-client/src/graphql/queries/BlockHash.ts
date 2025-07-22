import { Query } from '../../effect';
import { gql } from '../generated';

export const BlockHash = Query.make(
  'BlockHash',
  gql(`
    query BlockHash($offset: BlockOffset) {
      block(offset: $offset) {
        height
        hash
      }
    }
  `),
);
