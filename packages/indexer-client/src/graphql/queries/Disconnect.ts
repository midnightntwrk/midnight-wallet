import { Query } from '../../effect/index.js';
import { gql } from '../generated/index.js';

export const Disconnect = Query.make(
  'Disconnect',
  gql(`
    mutation Disconnect($sessionId: HexEncoded!) {
      disconnect(sessionId: $sessionId)
    }
  `),
);
