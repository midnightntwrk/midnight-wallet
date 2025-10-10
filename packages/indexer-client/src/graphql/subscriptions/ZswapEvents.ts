import { Subscription } from '../../effect/index.js';
import { gql } from '../generated/index.js';

export const ZswapEvents = Subscription.make(
  'ZswapEvents',
  gql(`
    subscription ZswapEvents($id: Int) {
      zswapLedgerEvents(id: $id) {
        id
        raw
        maxId
      }
    }
  `),
);
