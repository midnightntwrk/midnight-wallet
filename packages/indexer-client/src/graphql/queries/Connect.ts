import { Query } from '../../effect/index.js';
import { gql } from '../generated/index.js';

export const Connect = Query.make(
  'Connect',
  gql(`
    mutation Connect($viewingKey: ViewingKey!) {
      connect(viewingKey: $viewingKey)
    }
  `),
);
