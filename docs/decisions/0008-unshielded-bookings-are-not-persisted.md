# Unshielded bookings are process state, not persisted state

- Status: accepted
- Deciders: Ian Gregson
- Date: 2026-09-01

Technical Story: [#697](https://github.com/midnightntwrk/midnight-wallet/issues/697) — a leaked unshielded booking gets
duplicated into both UTxO maps, and the balance doubles.

## Context and Problem Statement

The unshielded wallet holds its coins in two maps, `availableUtxos` and `pendingUtxos`. Balancing a transaction moves a
coin from the first to the second — a **booking** — so coin selection cannot hand the same coin to a second transaction.
The maps are disjoint by construction, and every balance accessor sums them independently, so a coin present in both is
counted twice.

Both maps are written to the persisted snapshot. A booking therefore outlives the process that took it, while the thing
it represents — a caller in that process intending to submit a transaction — does not. That mismatch produced #697: a
booking was taken during balancing, the transaction was abandoned before it reached the proof server, and the booking
was persisted. On the next start the wallet restored the booking and resynced from its cached cursor, the indexer
replayed the transaction that had created the booked coin, and `applyUpdate` put that coin back into `availableUtxos`
while it was still in `pendingUtxos`. The wallet then reported exactly twice its on-chain balance, and reported the coin
as both spendable and booked, with deleting the persisted state the only recovery.

The immediate defects are fixable in place, and were: guard `applyUpdate` against re-admitting a booked coin, repair the
invariant in `restore`, and expire a booking at the TTL of the transaction it was taken for. The question this ADR
answers is different: should a reservation that expresses in-process intent be durable at all?

## Decision Drivers

- A booking represents a caller's intent to submit. That intent cannot survive the process that holds it.
- The disjointness of the two maps is load-bearing for every balance figure the SDK reports, yet it is maintained by
  convention across several call sites rather than by the type.
- Corrupted persisted state was unrecoverable without deleting the cache — the worst possible failure mode for a wallet.
- Coin selection must still refuse a coin that a submitted, unconfirmed transaction is spending, across a restart.
- Consumers already carry one breaking change for #697; a second one later is worse than a wider one now.

## Considered Options

- Keep bookings persisted, and reap them: guard `applyUpdate`, repair `restore`, expire at the transaction's TTL, and
  release restored bookings once sync completes.
- Keep bookings persisted, and shorten their life with a lease renewed while the caller is actively proving.
- Do not persist bookings. Hold them in process state, keyed against a single map of owned coins, and re-derive the
  exclusions that must survive a restart from the pending-transactions service.

## Decision Outcome

Chosen option: **do not persist bookings**, because it removes the class of defect rather than the occurrence, and
because it makes the invariant that broke unrepresentable instead of enforced.

The state becomes one map of owned coins plus a map of reservations keyed by coin:

```ts
interface UnshieldedState {
  readonly utxos: HashMap<UtxoHash, UtxoWithMeta>; // every coin this wallet owns
  readonly bookings: HashMap<UtxoHash, Booking>; // reservations, keyed by coin
}
```

A coin exists once. A booking is a key pointing at it. There is no second map for a coin to be in, so the duplication in
#697 cannot be constructed — by the type, not by a check. The three views consumers read are derived: available is
`utxos` minus booked keys, pending is `utxos` restricted to booked keys, total is `utxos`.

The snapshot keeps its existing format, writing both `availableUtxos` and `pendingUtxos`, but decoding unions them into
`utxos` and discards every booking. That repairs an already-corrupted snapshot as a side effect of decoding: a map keyed
by `intentHash#outputNo` cannot hold the same coin twice.

The exclusion that must survive a restart — the coins a submitted, unconfirmed transaction is spending — is re-derived
rather than persisted. Each transaction in the pending-transactions service has this wallet's inputs extracted and
booked, with that transaction's own TTL as their expiry. The facade does this whenever the set of owned coins changes
rather than once at startup, because a restored wallet's coins may still be arriving by sync and a coin cannot be
reserved before it is owned. Keying the reaction on the owned set is also what stops it feeding itself: booking changes
the reservations, never the coins. Every facade path that proves or submits registers with that service, at proving
(`finalizeTransaction`, `finalizeRecipe`) and at submission (`submitTransaction`), so the durable record of an in-flight
spend is the transaction itself rather than a reservation standing in for it.

Expiry is kept for the case that remains: a live process that balances a transaction and never proves it. That booking
is released at the TTL of the transaction it was taken for, since past that instant the ledger would reject the
transaction and the reservation cannot still be valid.

### Positive Consequences

- The reported defect becomes unrepresentable rather than guarded against, and an already-corrupted snapshot repairs
  itself on load with no dedicated repair path.
- A leaked booking can no longer outlive its process, so the worst case shrinks from "permanently wrong balance,
  recoverable only by deleting the cache" to "one coin unavailable to one session, released at the transaction's TTL".
- The durable record of an in-flight spend is the transaction, in the service built to track transactions, rather than a
  reservation in wallet state that nothing reconciles against it.
- Several mechanisms added while fixing #697 are no longer needed and are removed: the persisted `booking` field,
  `restore`'s disjointness repair, the release of restored bookings, and the strict-sync gating that release required.
- `balances` stops depending on a previous process's caller intent. What a restored wallet reports is chain truth plus
  the transactions it knows are in flight.

### Negative Consequences

- A consumer that submits through its own injected `SubmissionService` without registering the transaction with the
  pending-transactions service loses its exclusion across a restart, where a persisted booking would have preserved it.
  Registration becomes a documented requirement for a transaction to survive a restart. This is accepted deliberately:
  the alternative is persisting caller intent, which is the cause under discussion.
- The persisted snapshot keeps its existing shape — `serialize` still writes `availableUtxos` and `pendingUtxos`, so an
  older reader still understands a new snapshot — but the split it records is no longer authoritative. A new snapshot
  read by an older version presents a booked coin as pending with no expiry, which that version releases on its first
  sweep. What changed is the meaning of the two arrays, not the format, and nothing in the wallet reads the split back.
- Balance accessors do a set subtraction rather than reading a stored map. The cost is proportional to the number of
  bookings, which is bounded by the coins a caller can balance at once.
- Two names in the unshielded package now describe the same coins from inside and outside: `state.bookings` holds the
  reservations, and the public `pendingCoins` reports the coins those reservations cover. See the vocabulary note below
  for why they were not unified.

## Pros and Cons of the Options

### Keep bookings persisted, and reap them

The fix as first implemented for #697.

- Good, because it is contained: a filter in `applyUpdate`, a repair in `restore`, an expiry sweep in both sync
  capabilities.
- Good, because it needs no schema reshape, and old snapshots decode unchanged.
- Bad, because the invariant stays a convention. Every future writer of the two maps must remember the guard.
- Bad, because a persisted booking is still caller intent that outlived its caller; the reaping bounds the damage rather
  than removing its source.
- Bad, because releasing a restored booking safely requires waiting for strict sync completeness, which required
  changing what the simulator sync capability reports as progress — a change with readers beyond bookings.

### Keep bookings persisted, and shorten their life with a lease

- Good, because it bounds the stuck window to the lease rather than to the caller's TTL, with no consumer changes.
- Bad, because the lease is invented by the SDK rather than derived from the transaction, so a caller that legitimately
  proves later than the lease — offline signing, batching — loses a reservation that was still meaningful.
- Bad, because renewal introduces a heartbeat into a state machine that otherwise advances only on sync updates.

### Do not persist bookings

- Good, because the defect class disappears: no persisted booking means no booking to collide with replayed sync data.
- Good, because the invariant is expressed in the type instead of maintained by call sites.
- Good, because it deletes more code than it adds, and removes a repair path by making the thing it repairs impossible.
- Bad, because it shifts one correctness dependency onto the pending-transactions service being told about every
  submission.

## Relationship to the shielded and dust wallets

This decision brings the unshielded wallet to the model the other two already use, rather than moving it away from them.
Both hold one set of owned coins and subtract reservations from it to answer "what can I spend":
`shielded-wallet/src/v1/CoinsAndBalances.ts` filters `state.coins` by the nonces in `state.pendingSpends`, and
`dust-wallet/src/v1/CoinsAndBalances.ts` filters by `state.pendingDust`. Neither can hold a coin in two collections, so
neither can produce #697. The unshielded wallet was the one carrying two maps.

The structure is now the same in all three; the vocabulary is not, and the names were deliberately left alone:

| Concept                            | Unshielded            | Shielded                      | Dust                   |
| ---------------------------------- | --------------------- | ----------------------------- | ---------------------- |
| Coins owned                        | `state.utxos`         | `state.coins`                 | `state.coins`          |
| Reservations held                  | `state.bookings`      | `state.pendingSpends`         | `state.pendingDust`    |
| Reservation expiry                 | `expiresAt`, required | `Date \| undefined`, optional | ledger's `processTtls` |
| Reservations exposed to a consumer | `bookings`            | not exposed                   | not exposed            |

Shielded and dust hold the ledger's own types — `ledger.ZswapLocalState` and `DustLocalState` — so `coins`,
`pendingSpends` and `pendingDust` are the ledger's field names, not names this SDK chose. Adopting them for a type we
own would import the ledger's vocabulary into our own state and, worse, put two words for one thing inside the
unshielded package, whose public accessor for the same coins is `pendingCoins`. `utxos` is kept because every adjacent
name in that package is UTxO-shaped (`UtxoWithMeta`, `UtxoHash`, `ledger.Utxo`), and `booking` is kept because it names
a reservation _with a lifetime_, which is the property #697 turned on.

**One trap worth stating plainly**, because no rename fixes it: `pendingCoins` means different things on the two
wallets. On the unshielded wallet it is coins reserved by an outgoing spend; on the shielded wallet it is coins
_expected to arrive_, read from `pendingOutputs`. Both accessors predate this decision, and changing either is a
breaking change to a name this work did not introduce.

## Links

- Refines [ADR-0001](0001-bloc-wallet-state.md) — state lives in refs and is transformed by pure functions; this ADR
  changes the shape of the unshielded wallet's state, not how it is held or published.
- Constrained by [ADR-0006](0006-structure-for-flexibility-and-robustness.md) — the state shape is part of a variant, so
  the change is scoped to `v1` of the unshielded wallet and its serialization capability.
