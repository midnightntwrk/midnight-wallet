# Shielded bookings expire in the shielded wallet, at most a lifetime after sync first sees them

- Status: accepted
- Date: 2026-10-08

Technical Story: [#705](https://github.com/midnightntwrk/midnight-wallet/issues/705) — shielded coins booked for a
transaction that is abandoned, or never included, stay locked for good.

## Context and Problem Statement

Balancing a shielded transaction books the coins it spends in the ledger's `pendingSpends`, which is saved with the
wallet. Inclusion clears a booking and so does an explicit revert, but nothing else does: the SDK booked with no expiry,
and the ledger's own sweep, `ZswapLocalState.clearPending`, is a no-op in both ledger-v8 and ledger-v9. There is no
written answer from the ledger team on whether or when it will work, so an expiry-based release cannot wait for it. A
caller that abandons a transaction, a transaction that never lands, or a builder that fails part-way therefore left
coins unspendable across restarts, with nothing to say why.

[ADR-0009](0009-unshielded-bookings-persist-and-expire.md) solved the same leak for the unshielded wallet and set the
rule this must keep: exactly one mechanism releases a booking. Its fix — the wallet sweeping its own state — was thought
not to transfer, because the booking lives in the ledger's state rather than the SDK's.

What releases an abandoned shielded booking, and how does that stay the only thing that does?

## Decision Drivers

- A wallet used without the facade has to be covered, as the unshielded wallet's is.
- One mechanism releases a booking; two on different clocks can free a coin another transaction has since booked.
- A coin must never be released while a transaction spending it could still be included.
- No breaking change to the API a wallet user calls, and no new format version; a custom sync source may be asked for
  more.

## Considered Options

- The facade releases a shielded booking when the reservation recording it expires.
- The shielded wallet sweeps its own bookings during sync, as the unshielded wallet does.
- Wait for the ledger's `clearPending`.

## Decision Outcome

Chosen option: **the shielded wallet sweeps its own bookings during sync**, because it covers a wallet used without the
facade and keeps one releaser per wallet. It turns out the booking can be released from outside the ledger after all:
re-deriving a spend and reporting it failed (`spend` then `applyFailed`) un-books one coin, which the V2 variant already
does for coins stranded by a fork. The sweep stands whether or not `clearPending` is ever implemented.

- **Lifetime.** A booking lasts `min(transaction TTL, global_ttl)`. A shielded input is valid only while the Merkle root
  it was proven against is still in the chain's root history, and that history drops roots older than `global_ttl`
  (`spec/zswap.md`, `apply_input`), and the ledger includes a transaction only while its `intent.ttl` is no more than
  `global_ttl` past the block it lands in. So no shielded spend can be included later than `global_ttl` after it was
  built, whatever TTL its transaction carries, and none after its own TTL either. The SDK cannot read `global_ttl` from
  the chain, so the wallet uses 14 days: the `global_ttl` in both parameter sets the ledger ships
  (`ledger/params/mainnet.json` and `ledger/params/rel-1.1-advisory.json`, 1209600 seconds), not the one hour of the
  ledger's built-in `INITIAL_PARAMETERS` (`ledger/src/structure.rs`). With the shorter value, a coin released after an
  hour on mainnet could be booked again while the transaction that first spent it can still land. The lifetime is
  counted from when sync first saw the booking. Every facade method that builds a shielded transaction takes its TTL
  from the caller and passes it on, so a booking taken through the facade lasts until the caller's TTL, capped at 14
  days; only a shielded wallet used directly, with no TTL given, holds a coin for the full 14 days. The wallet records
  the transaction's TTL itself when it books the coins: both ledger-v8 and ledger-v9 accept a TTL on `spend` but store
  `undefined` in `pendingSpends`, so it cannot be read back from the ledger.
- **Clock.** Every sync update carries the time its source stamped it: the system clock on the indexer path, the
  simulator's time on the simulator path. The sync capability expires bookings against that time and reads no clock of
  its own, so the start and the check come off the same clock, with no clock added to any API. A booking restored from a
  snapshot that recorded no first-seen time is treated the same way, so it is never released early.
- **When.** Strictly after the deadline, never at it, and on the indexer path only once sync has caught up, for the
  reasons ADR-0009 gives. The indexer source sends a heartbeat every version-watch interval (30 seconds by default, off
  when the interval is zero or less): an update with no events, carrying the time. So a chain with no shielded traffic
  still releases.
- **Persistence.** The snapshot holds an optional `bookings` field, one record per booked coin by nonce, with when sync
  first saw the booking and the transaction's TTL, each optional. No format version bump under
  [ADR-0008](0008-persisted-format-versioning.md), and the field is absent when nothing is booked.
- **Revert.** Reverting a transaction drops the booking records of its coins, so booking one of them again starts a
  fresh lifetime.
- **Visibility.** `ShieldedWalletState.reservedCoins` lists each booked coin with when sync first saw it and when it
  will be released, distinct from `pendingCoins`, which are coins expected to arrive.
- **Record.** The facade records a reservation for every shielded booking, naming the coins by nullifier in the record's
  `inputs.shielded`. It is a record of who holds the coins, not a release instruction: when it expires it retires only
  itself, as ADR-0009 already has it.
- **Builder failures.** A facade builder that fails part-way releases what it booked, in every wallet, before it
  rejects. This is not a second releaser: the booking is undone before the builder returns, so no other transaction can
  yet hold the coin. If a release itself fails, the caller gets an `AggregateError` carrying the original error and each
  failed release, so a failed release is never silent.

### Negative Consequences

- A chain configured with a `global_ttl` longer than 14 days could, in principle, still include a shielded spend after
  the wallet released its coin. The worst case is that a later transaction spending the same coin fails on its
  nullifier; no funds are lost. A chain with a shorter `global_ttl` only keeps a coin booked longer than it needs to.
- A booking is released up to one version-check interval later than its deadline, and its deadline starts up to one
  heartbeat interval after it was taken. Both err towards holding the coin.
