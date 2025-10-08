import { Subscription } from '../../effect';
import { gql } from '../generated';

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
