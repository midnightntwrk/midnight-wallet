import { Query } from '../../effect/index.js';
import { gql } from '../generated/index.js';

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
