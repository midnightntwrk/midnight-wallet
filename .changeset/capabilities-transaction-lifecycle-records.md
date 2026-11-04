---
'@midnightntwrk/wallet-sdk-capabilities': major
---

feat(capabilities)!: track each transaction as one lifecycle record

The pending-transactions service is replaced by `TransactionLifecycleService`, which keeps one record per transaction
from balancing to its final state: `Balanced` → `Finalized` → `Submitted`, ending `Confirmed`, `Rejected`, `Orphaned`,
`Expired` or `Reverted` (ADR 0011). An ended record stays until its TTL passes. `serializeState()` saves the store, and
`TransactionLifecycleServiceImpl.restore` reads it back.

The stored format moves from `v1` to `v2`. A `v1` store is read and upgraded; earlier releases refuse `v2`.

BREAKING CHANGE — renamed and reshaped, with no deprecated aliases:

| Before | After |
| --- | --- |
| subpath `./pendingTransactions` | `./transactionLifecycle` |
| `PendingTransactionsService` and its implementations | `TransactionLifecycleService`, `TransactionLifecycleServiceImpl`, `TransactionLifecycleServiceEffect(Impl)` |
| `InitParams`, `DefaultPendingTransactionsServiceConfiguration` | `TransactionLifecycleServiceInitParams`, `DefaultTransactionLifecycleServiceConfiguration` |
| `addPendingTransaction`, `clear`, `addReservation`, `clearReservation` | `balanced`, `finalized`, `submitted`, `reverted`, `included` |
| a custom service | must also implement `serializeState()` |
| `PendingTransactions.TransactionTrait` and the other trait helpers | the same names under `TransactionTraits` |
| `TransactionTrait.hasTTLExpired`, `isOneIncludedInOther` | removed; a trait now provides `intentHashes`, `inputs` and `ttl` |
| `PendingTransactions` state functions, reservations and items | `Lifecycle` (`LifecycleRecord`, `LifecycleState` and the moves between them) |
| `PendingTransactions.serialize`, `deserialize` | `Lifecycle.serialize`, `Lifecycle.deserialize`; format versions in `LifecycleFormat` |

## Migrating from `PendingTransactionsService` to `TransactionLifecycleService`

Applications that use the facade follow the step-by-step guide in the `@midnightntwrk/wallet-sdk-facade` changelog for
this release. The steps below are for code that drives the service itself.

1. **Build it the same way, under the new names.** `init` and `restore` take the same arguments as before, plus an
   optional clock.

   ```ts
   // Before
   const service = await PendingTransactionsServiceImpl.init({ txTraits, configuration });
   const restored = await PendingTransactionsServiceImpl.restore(stored, txTraits, configuration);
   // After
   const service = await TransactionLifecycleServiceImpl.init({ txTraits, configuration, clock });
   const restored = await TransactionLifecycleServiceImpl.restore(stored, txTraits, configuration, clock);
   ```

   `start()` and `stop()` are unchanged. `stop()` now also guarantees no indexer query runs after it resolves.

2. **Report each step of a transaction, not "pending" and "reservation".** The old service kept two records for one
   spend; the new one keeps one record per transaction, moved by each step:

   | Before | After |
   | --- | --- |
   | `addReservation(reservation)` after balancing | `balanced(facts)`, with the transaction's proofs erased |
   | nothing between balancing and submitting | `finalized(facts)` after proving |
   | `addPendingTransaction(tx, version)` on submit | `submitted(facts)` |
   | `clearReservation(identifiers)` or `clear(tx)` on a revert | `reverted(identifiers)` |
   | the poller's verdict only | `included(identifiers, verdict)` too, for an inclusion your sync sees first |
   | `orphanBeyond(chainNow)` | unchanged |

   Every move takes `facts`, read off the transaction by its trait:

   ```ts
   const facts = {
     tx,
     identifiers: trait.ids(tx),
     intentHashes: trait.intentHashes(tx),
     inputs: trait.inputs(tx),
     ttl: trait.ttl(tx, now),
     protocolVersion,
   };
   await service.submitted(facts);
   ```

3. **Read records, not `all` and `reservations`.** `state()` now gives `{ records }`. Each record has a `state`
   (`Balanced`, `Finalized`, `Submitted`, `Confirmed`, `Rejected`, `Orphaned`, `Expired` or `Reverted`), its
   `identifiers`, `inputs`, `ttl`, `submittedAt` and the transaction it holds. An ended record stays until its TTL
   passes, so test `Lifecycle.isLive(record)` rather than whether the list is empty.

4. **Save with the service.** Use `await service.serializeState()` in place of `PendingTransactions.serialize(state,
   traits)`. A `v1` store written by the old service restores as records; once saved again it is `v2`, which the old
   service refuses.

5. **Custom implementations.** A custom service must implement every member above, `serializeState()` included. A
   custom `TransactionTrait` adds `intentHashes`, `inputs` and `ttl`, drops `hasTTLExpired` and
   `isOneIncludedInOther`, and may add `formOf` if its bytes do not show whether a transaction is finalized.
