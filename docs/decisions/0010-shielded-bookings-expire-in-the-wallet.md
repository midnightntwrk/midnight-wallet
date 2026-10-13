# Shielded bookings expire in the shielded wallet, a lifetime after sync first sees them

- Status: proposed
- Date: 2026-10-08

Technical Story: [#705](https://github.com/midnightntwrk/midnight-wallet/issues/705) — shielded coins booked for a
transaction that is abandoned, or never included, stay locked for good.

## Context and Problem Statement

Balancing a shielded transaction books the coins it spends in the ledger's `pendingSpends`, which is saved with the
wallet. Inclusion clears a booking and so does an explicit revert, but nothing else does: the SDK booked with no expiry,
and the ledger's own sweep, `ZswapLocalState.clearPending`, is a no-op in both ledger-v8 and ledger-v9. The ledger team
does not plan to make it work any time soon, so an expiry-based release cannot wait for it. A caller that abandons a
transaction, a transaction that never lands, or a builder that fails part-way therefore left coins unspendable across
restarts, with nothing to say why.

[ADR-0009](0009-unshielded-bookings-persist-and-expire.md) solved the same leak for the unshielded wallet and set the
rule this must keep: exactly one mechanism releases a booking. Its fix — the wallet sweeping its own state — was thought
not to transfer, because the booking lives in the ledger's state rather than the SDK's.

What releases an abandoned shielded booking, and how does that stay the only thing that does?

## Decision Drivers

- A wallet used without the facade has to be covered, as the unshielded wallet's is.
- One mechanism releases a booking; two on different clocks can free a coin another transaction has since booked.
- A coin must never be released while a transaction spending it could still be included.
- No change to any public API, and no new format version.

## Considered Options

- The facade releases a shielded booking when the reservation recording it expires.
- The shielded wallet sweeps its own bookings during sync, as the unshielded wallet does.
- Wait for the ledger's `clearPending`.

## Decision Outcome

Chosen option: **the shielded wallet sweeps its own bookings during sync**, because it covers a wallet used without the
facade and keeps one releaser per wallet. It turns out the booking can be released from outside the ledger after all:
re-deriving a spend and reporting it failed (`spend` then `applyFailed`) un-books one coin, which the V2 variant already
does for coins stranded by a fork.

- **Lifetime.** A shielded input is valid only while the Merkle root it was proven against is still in the chain's root
  history, and that history drops roots older than `global_ttl` (`spec/zswap.md`, `apply_input`). So no shielded spend
  can be included later than `global_ttl` after it was built, whatever TTL its transaction carries. A booking is given
  that lifetime: the ledger's default, one hour, since the parameter is not exposed to the SDK.
- **Clock.** The lifetime is counted from the first sync update that sees the booking, so the start and the check are
  read off the same clock — system time on the indexer path, the simulator's time on the simulator path — with no clock
  added to any API. A booking restored from a snapshot that recorded no deadline is treated the same way, so it is never
  released early.
- **When.** Strictly after the deadline, never at it, and on the indexer path only once sync has caught up, for the
  reasons ADR-0009 gives. The version check that runs every 30 seconds is followed by an empty batch of events, so a
  chain with no shielded traffic still releases.
- **Persistence.** The deadlines are saved in the snapshot as an optional `bookingDeadlines` field: no format version
  bump under [ADR-0008](0008-persisted-format-versioning.md), and absent when nothing is booked.
- **Visibility.** `ShieldedWalletState.reservedCoins` lists each booked coin with when sync first saw it and when it
  will be released, distinct from `pendingCoins`, which are coins expected to arrive.
- **Record.** The facade records a reservation for every shielded booking, naming the coins by nullifier in the record's
  `inputs.shielded`. It is a record of who holds the coins, not a release instruction: when it expires it retires only
  itself, as ADR-0009 already has it.
- **Builder failures.** A facade builder that fails part-way releases what it booked, in every wallet, before it
  rejects. This is not a second releaser: the booking is undone before the builder returns, so no other transaction can
  yet hold the coin.

### Negative Consequences

- A chain configured with a `global_ttl` longer than the default could, in principle, still include a shielded spend
  after the wallet released its coin. The worst case is that a later transaction spending the same coin fails on its
  nullifier; no funds are lost.
- A booking is released up to one version-check interval later than its deadline, and its deadline starts up to one
  interval after it was taken. Both err towards holding the coin.
