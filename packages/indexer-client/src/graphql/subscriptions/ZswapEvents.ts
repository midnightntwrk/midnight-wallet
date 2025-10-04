import { Subscription } from '../../effect';
import { gql } from '../generated';

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
