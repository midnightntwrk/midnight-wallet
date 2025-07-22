import { Query } from '../../effect';
import { gql } from '../generated';

export const Disconnect = Query.make(
  'Disconnect',
  gql(`
    mutation Disconnect($sessionId: HexEncoded!) {
      disconnect(sessionId: $sessionId)
    }
  `),
);
