# Unshielded bookings persist, expire at their transaction's TTL, and are reconciled against a durable record

- Status: proposed
- Deciders: Ian Gregson, Agron Murtezi, Andrzej Kopeć
- Date: 2026-09-11

Technical Story: [#697](https://github.com/midnightntwrk/midnight-wallet/issues/697) — a leaked unshielded booking gets
duplicated into both UTxO maps, and the balance doubles.

## Context and Problem Statement

The unshielded wallet holds its coins in two maps, `availableUtxos` and `pendingUtxos`. Balancing a transaction moves a
coin from the first to the second — a **booking** — so coin selection cannot hand the same coin to a second transaction.
The maps are disjoint by construction, and every balance accessor sums them independently, so a coin present in both is
counted twice.

Two defects combined to produce exactly that. The indexer sync path re-admitted a created coin without checking whether
it was still booked, so a resync from a cursor predating the creating transaction put the coin back into
`availableUtxos` while it was also pending. And a booking was released only through the submit path, so a transaction
abandoned between balancing and submission — a proof server on a mismatched ledger version, in the reported case — left
its coins booked forever. Persisted, that state survived every restart: the wallet reported twice its on-chain balance,
reported the same coin as both spendable and booked, and deleting the cache was the only recovery.

The immediate guard is obvious and was never in dispute. The question this ADR answers is what a booking _is_: process
state belonging to the caller that took it, or a durable record of something the wallet has released into the world.

## Decision Drivers

- A coin can be booked for a transaction that legitimately takes a long time — a swap counterpart sitting in an external
  system, waiting on someone else — and a restart must not invalidate it.
- Nothing may release a coin that a live transaction is still spending; coin selection would then hand it out twice.
- A booking taken while proving is in flight looks exactly like a leaked one: the indexer reports the input unspent and
  no transaction is being tracked yet.
- Corrupted persisted state was unrecoverable without deleting the cache — the worst failure mode for a wallet.
- An unproven transaction carries key material and must never be written to storage.
- Whatever is built here should be a model the shielded and dust wallets can adopt, since they have the same gap.

## Considered Options

- Keep bookings persisted, expire them at the transaction's TTL, and reconcile what comes back from a snapshot against a
  durable record of the transaction that took it.
- Keep bookings persisted, and shorten their life with a lease renewed while the caller is actively proving.
- Do not persist bookings. Hold them in process state and re-derive, after a restart, the exclusions that must survive.

## Decision Outcome

Chosen option: **keep bookings persisted, expire them at the transaction's TTL, and reconcile against a durable
record**, because a booking is not the caller's private intent. It reflects something the wallet has already released
into the world, and a wallet that forgets it on restart can invalidate a transaction that is still perfectly valid.

Four mechanisms, smallest first. Each is useful without the ones after it.

**1. The invariant is enforced where it was broken.** The indexer sync path no longer re-admits a created coin that is
still booked, the guard the simulator path already had. Loading a snapshot that holds one coin in both maps keeps it on
the pending side only, so state already corrupted in the field repairs itself on the next start rather than carrying the
duplicate forward.

**2. A booking carries the TTL of the transaction it was taken for**, and both sync capabilities release expired
bookings on every applied update — the indexer path against wall time, the simulator path against simulator time. Past
that instant the ledger rejects the transaction, so the reservation cannot still be valid. This bounds the damage of any
abandoned transaction to that transaction's own lifetime, with no help from the caller, and it is the floor for a wallet
used without the facade. A snapshot written before bookings carried a TTL decodes at the epoch, so the first sweep
releases it — which is the repair such a snapshot needs.

**3. A balanced transaction is recorded as a reservation** in the pending-transactions service: the identifiers of the
transaction, the intent hashes, the ids of the coins it booked, and the TTL. It never holds the transaction itself.
Between balancing and submission nothing else recorded that those coins were spoken for, and this is that record. It
persists, so it survives the restart that the swap case turns on. Registering or clearing the real transaction drops the
reservation standing in for it, and the service's existing poll marks one whose TTL has passed so the facade can release
its coins.

**4. Bookings restored from a snapshot are reconciled once sync reaches the chain tip.** At that point every transaction
the address is party to has been applied, so a coin still booked was never spent by the process that booked it — unless
a reservation says its transaction is still out there. Uncovered coins are released in seconds instead of waiting out a
TTL that defaults to an hour; covered ones stay booked.

The last mechanism is the one that has to be stated carefully, because both of its simpler forms are wrong. Releasing
restored bookings once sync completes, unguarded, would invalidate a swap whose counterpart has not answered. Never
releasing them leaves a coin stuck for up to an hour after sync has already proved nothing holds it. The reservation is
what makes the difference visible to the wallet, and the guard is one sentence: **release a restored booking when sync
is strictly complete, unless a reservation accounts for it.**

### Positive Consequences

- The reported defect is closed at its source, and an already-corrupted snapshot repairs itself on load.
- A booking can no longer outlive its transaction. The worst case shrinks from "permanently wrong balance, recoverable
  only by deleting the cache" to "one coin unavailable until its transaction's TTL".
- A booking survives a restart, so a transaction waiting on someone else is not invalidated by one.
- The coins a transaction reserved are recorded before it is proven, which closes the window where an abandoned
  transaction left nothing behind to explain the missing balance.
- The TTL is the common expiry language across the three wallets, and the reservation's per-wallet `inputs` section is
  shaped for shielded and dust to add their own without a format change.

### Negative Consequences

- A pending coin's stored shape gained a field, and `spend` gained a required argument, so this is a breaking change for
  anyone driving the wallet's state functions directly.
- The pending-transactions store gained a new format version. A snapshot written before this change still loads, but a
  snapshot written after it cannot be read by an earlier version of the package.
- A consumer that balances through its own code rather than the facade gets no reservation, so its bookings are
  protected by the TTL alone. That is the same protection they had before, not a regression.
- The facade's trigger for the fourth mechanism has no automated test: the simulator never reports a chain tip, so the
  condition cannot be reached in the simulator harness. The wallet behaviour behind it is covered against a real
  indexer; the one-line subscription that calls it is not.

## Pros and Cons of the Options

### Persist, expire at the TTL, reconcile against a durable record

- Good, because a booking that reflects a live transaction survives a restart, which is the case a wallet cannot get
  wrong without invalidating real transactions.
- Good, because it matches the model the ledger designed for the other two wallets — `pendingSpends` with an optional
  expiry for shielded, `pendingDust` with `processTtls` for dust — keeping one mental model across all three.
- Good, because the reservation gives the proving window an answer: a transaction being proved is registered before
  proving starts, so a reconciler can tell it apart from an abandoned one.
- Bad, because the invariant that broke is still maintained by call sites rather than by the type. Every future writer
  of the two maps has to remember the guard.
- Bad, because correctness now leans on the facade registering a reservation at every booking site, and there are six.

### Shorten the life with a renewed lease

- Good, because it bounds the stuck window to the lease rather than to the caller's TTL, with no consumer changes.
- Bad, because the lease is invented by the SDK rather than derived from the transaction, so a caller that legitimately
  proves later than the lease — offline signing, batching — loses a reservation that was still meaningful.
- Bad, because renewal introduces a heartbeat into a state machine that otherwise advances only on sync updates.

### Do not persist bookings

- Good, because the defect class disappears: no persisted booking means none to collide with replayed sync data, and the
  invariant can be expressed in the type rather than maintained by call sites.
- Good, because it deletes more code than it adds.
- Bad, and decisive: a booking is not only process state. It also reflects reality the wallet has left behind. A wallet
  that issues a swap counterpart which then sits in an external system for an unspecified time, and is restarted in the
  meantime, loses the booking and may invalidate that swap.
- Bad, because it makes correct behaviour depend on every consumer registering every submission, and silently degrades
  for one that submits through its own service.

## Relationship to the shielded and dust wallets

All three wallets reserve coins while balancing, and all three have to decide when a reservation is no longer valid. The
ledger owns that state for shielded and dust; the SDK owns it for unshielded.

| Concept            | Unshielded                      | Shielded                                  | Dust                         |
| ------------------ | ------------------------------- | ----------------------------------------- | ---------------------------- |
| Coins owned        | `availableUtxos` + `pending`    | `state.coins`                             | `state.coins`                |
| Reservations held  | `pendingUtxos`                  | `pendingSpends` (ledger)                  | `pendingDust` (SDK) + ledger |
| Reservation expiry | `ttl`, required                 | `Date \| undefined`, never set by the SDK | ledger's `processTtls`       |
| Reaped by          | the wallet, on each sync update | nothing — `clearPending` is a no-op       | the ledger                   |

Shielded has the same leak and cannot use the same fix directly: `pendingSpends` is the ledger's own field, serialized
with its state, and the ledger's expiry endpoint is documented as non-functional. That is tracked separately. What
transfers is the shape rather than the code: the TTL as the expiry language, and the reservation record, whose `inputs`
is split per wallet precisely so shielded can add its own ids without another format change.

**One trap worth stating plainly**, because no rename fixes it: `pendingCoins` means different things on two wallets. On
the unshielded wallet it is coins reserved by an outgoing spend; on the shielded wallet it is coins _expected to
arrive_. Both accessors predate this decision.

## Follow-ups

- **Shielded reservations** have no expiry and nothing sweeps them, so the same leak exists there. The issue tracking it
  describes a facade accessor this decision did not build; the reservation list is the equivalent, and that issue's
  wording should be corrected to match.
- **Transaction history.** Tracking booked coins and tracking transaction history are closely related, and a reservation
  is arguably the first moment a transaction becomes worth recording. History is still written from submission onwards,
  and moving that earlier is a visible behaviour change for consumers, so it was left alone.

## Links

- Refines [ADR-0001](0001-bloc-wallet-state.md) — state lives in refs and is transformed by pure functions; this ADR
  changes what the unshielded wallet's state records, not how it is held or published.
- Constrained by [ADR-0006](0006-structure-for-flexibility-and-robustness.md) — the state shape belongs to a variant, so
  the change is scoped to `v1` of the unshielded wallet and its capabilities.
