import { Query } from '../../effect';
import { gql } from '../generated';

export const Connect = Query.make(
  'Connect',
  gql(`
    mutation Connect($viewingKey: ViewingKey!) {
      connect(viewingKey: $viewingKey)
    }
  `),
);
