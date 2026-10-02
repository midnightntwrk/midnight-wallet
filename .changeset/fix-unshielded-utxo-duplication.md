---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-facade': major
---

fix(unshielded-wallet)!: stop a leaked booking duplicating a UTxO and doubling the balance

A resync could re-admit a booked UTxO as available, and a booking taken while balancing was never released if the
transaction was abandoned before submission. Both were persisted, so the balance stayed doubled across restarts.

- Sync no longer re-admits a booked UTxO, and a snapshot holding one coin as both available and pending loads with it
  pending only, so corrupted state repairs itself on the next start.
- A booking carries its transaction's TTL and is released once sync has caught up and the TTL has passed.
- The facade records each balanced but unproven transaction as a reservation in the pending-transactions service (ids
  and TTL only, never the transaction). Bookings restored from a snapshot are released at the chain tip unless a
  reservation or a tracked transaction still accounts for them.
- Balancing in place now books the coins it selects.
- New `UnshieldedWallet.revertUtxos(ids)` releases booked coins by id.

Both stored formats gained an optional member, so a store written by this release is still readable by an earlier one.

BREAKING CHANGE:

- unshielded-wallet: `UnshieldedState.spend`, `UnshieldedState.spendByUtxo`, `CoreWallet.spend` and
  `CoreWallet.spendUtxos` take the transaction's TTL as a required last argument. `UnshieldedState.restore` and
  `toArrays` exchange pending entries as `{ utxo, ttl, restored }`. `UnshieldedWalletAPI` and `TransactingCapability`
  gain `revertUtxos` and `releaseRestoredPending`, which custom implementations must add.
- capabilities: `PendingTransactions` gains a required `reservations` field, and `PendingTransactionsService` and
  `PendingTransactionsServiceEffect` gain `addReservation` and `clearReservation`, which custom implementations must add.
- facade: a `pendingTransactionsService` or `unshielded` factory passed to `WalletFacade.init` must return an
  implementation with those new methods.
