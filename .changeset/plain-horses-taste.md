---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
---

feat: deterministically set balancing tx segment id

Replaced `Transaction.fromPartsRandomized` with `Transaction.fromParts` + explicit `intents.set(segmentId, intent)` when building balancing transactions, where `segmentId` is the lowest unused fallible segment in `[1, 65535]`. This makes segment placement deterministic and reproducible instead of random.

- **dust-wallet**: `dryRunFee` and `balanceTransactions` now merge the existing (proof-erased) transactions first, then pick a segment that doesn't collide with any of them before constructing the balancing tx. A new exported `findAvailableSegmentId` helper in `Transacting.ts` drives the lookup.
- **unshielded-wallet**: `balanceFinalizedTransaction` picks a segment that doesn't collide with the passed-in `FinalizedTransaction` before constructing the balancing tx. `findAvailableSegmentId` was added as a method on `TransactionOps`.
