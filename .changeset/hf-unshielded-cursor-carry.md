---
---

test(unshielded-wallet): assert the whole cursor a cross-ledger migration hands over

Test-only. `SyncProgressData` carries three fields across the boundary and the migration tests asserted one of them.
The fixture in `v2/test/migration.test.ts` sets `highestTransactionId` equal to `appliedId`, so a migration deriving
the source tip from the applied position — or dropping it and letting it default to zero — passed every test there.
The pair is what `SyncProgress.isCompleteWithin` reads, so a tip collapsed onto the applied position makes a wallet
report itself caught up at the moment it has the entire replay after the v9 fork still to consume.

Also pins `isConnected` resetting to `false` at the hand-over, which is structural rather than incidental:
connectivity belongs to a live subscription, and at the hand-over the new variant's sync has not been restarted yet.

Mutation-verified against this line: deriving the tip from `appliedId` in the migration leaves **256 of 257** unit
tests green and fails only the new case.
