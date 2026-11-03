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
- A transaction that misses its TTL before it is submitted gives back its Dust at once, not hours later.
- A chain verdict on a transaction finalized here but submitted by someone else, as in a swap, now ends its entry.
- Reverting a transaction that is not yet proven no longer stores its unproven bytes as its history key.

BREAKING CHANGE — renamed and reshaped, with no deprecated aliases:

| Before | After |
| --- | --- |
| `facade.pendingTransactionsService` | `facade.transactionLifecycleService` |
| `InitParams.pendingTransactionsService(config)` | `InitParams.transactionLifecycleService(config, { clock })` |
| restoring with `finalizedTransactionTraits` | `lifecycleTransactionTraits` |
| `FacadeState.pending`, `PendingTransaction`, `PendingStatus`, `pendingTransactionsOf` | `FacadeState.lifecycle`, `LifecycleEntry`, `LifecycleStatus`, `lifecycleEntriesOf` |
| `transaction: FinalizedTx`, `submittedAt: DateTime.Utc` | both `Option`s: none until finalized, and until submitted |
| status tags | add `Balanced`, `Finalized`, `PartialSuccess`, `Expired`, `Reverted` |
| `Confirmed { segments }`, `Rejected { segments }` | `Confirmed`, `Rejected { reason }` (`Refused { segments }` or `TTLPassed`) |
| a partial success shown as `Rejected { segments }` | `PartialSuccess { segments }` |
| `!state.pending.length` | `!state.lifecycle.some(isAwaiting)` |
| `finalizedTransactionTraits` entries' `hasTTLExpired`, `isOneIncludedInOther` | `intentHashes`, `inputs`, `ttl` |

## Migrating

1. **Read `state.lifecycle`, not `state.pending`.** Each entry's `transaction` and `submittedAt` are now `Option`s.

   ```ts
   // Before
   state.pending.map((pending) => pending.transaction);
   // After
   state.lifecycle.flatMap((entry) => Option.toArray(entry.transaction));
   ```

2. **Wait with `isAwaiting`, not for an empty list.** Ended entries stay listed until their TTL passes, so a check for
   an empty list could wait up to an hour.

   ```ts
   // Before
   await firstValueFrom(facade.state().pipe(filter((state) => state.pending.length === 0)));
   // After
   await firstValueFrom(facade.state().pipe(filter((state) => !state.lifecycle.some(isAwaiting))));
   ```

3. **Match the new statuses.** `Confirmed` has no `segments`. `Rejected` has a `reason`. A partial success is its own
   status, not a `Rejected`: the chain included the transaction and applied part of it, so do not re-submit it.

   ```ts
   switch (entry.status._tag) {
     case 'Balanced':
     case 'Finalized':
     case 'Submitted':
       return 'waiting';
     case 'Confirmed':
       return 'done';
     case 'PartialSuccess':
       return `applied in part: ${entry.status.segments.filter((s) => !s.success).length} segments failed`;
     case 'Rejected':
       return entry.status.reason._tag === 'Refused' ? 'refused by the chain' : 'TTL passed after submission';
     case 'Orphaned':
       return 'the chain moved past its protocol version: build it again';
     case 'Expired':
       return 'TTL passed before it was submitted';
     case 'Reverted':
       return 'given back by the wallet';
   }
   ```

4. **Rename the service.** `facade.pendingTransactionsService` is now `facade.transactionLifecycleService`, and the
   `InitParams.pendingTransactionsService(config)` factory is now `InitParams.transactionLifecycleService(config, { clock })`.
   Pass the clock on, so a restored service keeps the facade's time.

5. **Save and restore the store.** On restore, a store written by an earlier release (format `v1`) is read and upgraded.
   Once saved again it is `v2`, which earlier releases refuse, so keep the old string if you may roll back.

   ```ts
   const stored = await facade.transactionLifecycleService.serializeState();

   await WalletFacade.init({
     // ...
     transactionLifecycleService: (config, { clock }) =>
       TransactionLifecycleServiceImpl.restore(stored, lifecycleTransactionTraits(config.forks.v9), config, clock),
   });
   ```

6. **Custom service or trait.** A custom service must also implement `serializeState()`. A custom `TransactionTrait`
   adds `intentHashes`, `inputs` and `ttl`, and drops `hasTTLExpired` and `isOneIncludedInOther`.

7. **Imports.** Replace the `pendingTransactions` subpath with `transactionLifecycle`, in
   `@midnightntwrk/wallet-sdk-capabilities` and in `@midnightntwrk/wallet-sdk/capabilities`.
