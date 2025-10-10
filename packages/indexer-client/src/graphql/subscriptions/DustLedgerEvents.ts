import { Subscription } from '../../effect/index.js';
import { gql } from '../generated/index.js';

export const DustLedgerEvents = Subscription.make(
  'DustLedgerEvents',
  gql(`
    subscription DustLedgerEvents($id: Int) {
      dustLedgerEvents(id: $id) {
        type: __typename
        id
        raw
        maxId
      }
    }
  `),
);
