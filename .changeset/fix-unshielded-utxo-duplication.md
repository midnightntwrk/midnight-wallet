---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-facade': minor
---

fix(unshielded-wallet)!: stop a leaked booking duplicating a utxo and doubling the balance

A wallet holding only unshielded Night reported exactly twice its on-chain balance and kept doing so across restarts, with deleting the persisted state the only recovery (#697). The same UTxO was in `availableUtxos` and `pendingUtxos` at once, and every balance accessor sums the two independently.

The cause was that a **booking** — the reservation taken on a coin when a transaction is balanced — was written to the persisted snapshot. A booking expresses the intent of a caller in one process; the snapshot made it outlive that process. A booking taken during balancing was persisted, the transaction was abandoned before it reached the proof server, and on the next start the wallet restored the booking, resynced from its cached cursor, and the indexer replayed the transaction that had created the booked coin — putting that coin back into `availableUtxos` while it was still in `pendingUtxos`.

Bookings are no longer persisted, and the state that held them cannot represent the defect (ADR 0008):

- `UnshieldedState` is one map of owned coins plus a map of reservations keyed by coin. A coin exists once and a booking is a key pointing at it, so there is no second map for a coin to be in. The available and pending views are derived.
- A snapshot restores every coin it holds, in either array, with no bookings. That repairs an already-corrupted snapshot as a side effect of decoding, since a map keyed by `intentHash#outputNo` cannot hold the same coin twice.
- The coins an unresolved transaction in flight is spending are reserved again from the transaction itself, which the pending-transactions service persists. The facade does this on every applied sync update, so it covers both a wallet restored from a snapshot and one whose coins arrive later by sync; booking changes neither the sync cursor nor the coins, so a re-reservation cannot re-trigger itself.
- A booking taken in the running process and then abandoned — balanced, never proved — is released at the TTL of the transaction it was taken for, swept by both sync capabilities.
- `UnshieldedWalletState.bookings` reports each reservation with its `expiresAt`, and `FacadeState.unshieldedBookings` attributes each to the unresolved in-flight transaction that spends its coin; `Option.none` means nothing accounts for it and `facade.revert` releases it.

The persisted snapshot keeps its current format, so an older reader still understands a new snapshot. What changed is that the available/pending split it records is no longer restored.

BREAKING CHANGE: `UnshieldedState` is now `{ utxos, bookings }`. Read the two views through `UnshieldedState.availableUtxos(state)` and `UnshieldedState.pendingUtxos(state)` instead of the former fields of the same names. `UtxoMeta` no longer carries a `booking`; `UtxoBooking` is `{ expiresAt: Date }` and its `bookedAt` and `origin` fields and the `BookingOrigin` type are gone, along with `UnshieldedState.releaseRestoredBookings` and `CoreWallet.releaseRestoredBookingsIfSynced`. `UnshieldedState.spend`, `UnshieldedState.spendByUtxo`, `CoreWallet.spend` and `CoreWallet.spendUtxos` take a required `UtxoBooking` as their last argument — pass the TTL of the transaction the inputs are being booked for as `expiresAt`. `CoinsAndBalancesCapability` gains a required `getBookings` member, `TransactingCapability` and `UnshieldedWalletAPI` gain a required `bookTransaction`, so a custom implementation of any of those interfaces must add them.
