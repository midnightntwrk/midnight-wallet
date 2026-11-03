---
'@midnightntwrk/wallet-sdk-facade': major
---

feat(facade)!: show every transaction's lifecycle in FacadeState

The facade records each transaction it balances, finalizes, submits or reverts in
`facade.transactionLifecycleService`, and shows them in `FacadeState.lifecycle`. A finalized transaction that was never
sent now shows as `Finalized`, not `Submitted`, and `submittedAt` is when it was submitted. Ended entries stay listed
until their TTL passes; `isAwaiting` tells the ones still waiting for an answer.

Save the store with `facade.transactionLifecycleService.serializeState()` and hand it back through
`InitParams.transactionLifecycleService`:
`(config, { clock }) => TransactionLifecycleServiceImpl.restore(stored, lifecycleTransactionTraits(config.forks.v9), config, clock)`.
A balanced transaction is saved with its proofs erased, so the store holds no secret key.

Also fixed:

- `submitTransaction` records a transaction under its own protocol version, not the version the wallets last reported.
- `finalizeRecipe` gives back everything the recipe booked when finalizing it fails.

BREAKING CHANGE — renamed and reshaped, with no deprecated aliases:

| Before | After |
| --- | --- |
| `facade.pendingTransactionsService` | `facade.transactionLifecycleService` |
| `InitParams.pendingTransactionsService(config)` | `InitParams.transactionLifecycleService(config, { clock })` |
| restoring with `finalizedTransactionTraits` | `lifecycleTransactionTraits` |
| `FacadeState.pending`, `PendingTransaction`, `PendingStatus`, `pendingTransactionsOf` | `FacadeState.lifecycle`, `LifecycleEntry`, `LifecycleStatus`, `lifecycleEntriesOf` |
| `transaction: FinalizedTx`, `submittedAt: DateTime.Utc` | both `Option`s: none until finalized, and until submitted |
| status tags | add `Balanced`, `Finalized`, `Expired`, `Reverted` |
| `Confirmed { segments }`, `Rejected { segments }` | `Confirmed`, `Rejected { reason }` (`Refused { segments }` or `TTLPassed`) |
| `!state.pending.length` | `!state.lifecycle.some(isAwaiting)` |
| `finalizedTransactionTraits` entries' `hasTTLExpired`, `isOneIncludedInOther` | `intentHashes`, `inputs`, `ttl` |
