---
---

test(wallets): hard-fork migration, envelope and snapshot-parity coverage

Test-only, all three wallets. Each case exists because the shipped suite could not fail on the behaviour — in three
places because a fixture supplies the value a broken implementation would produce.

- **Migration seams.** The whole cursor a cross-ledger migration hands over, not just `appliedId`: the source tip
  carried rather than derived from the applied position (collapsing it makes a wallet report itself caught up with the
  entire replay after the v9 fork still to consume), and `isConnected` reset at the hand-over. Plus a migration handed the
  wrong dust parameters, which it accepts without complaint — there is no validation seam, and only
  `generationDecayRate` is observable, so a guard on `nightDustRatio` alone would fix nothing.
- **Snapshot envelopes.** Dust's and shielded's field sets pinned on both variants, that the two agree, and that each
  field is encoded as the reader expects with the ledger blob left opaque — a rename applied to writer and reader
  together passes every round trip.
- **Snapshot parity over wallets that hold something.** Dust: every UTxO with its generation info, both merkle roots
  and their first-free indices, the balance at one fixed instant, the sync position. Unshielded: both sides of the
  available/pending split, a value larger than a double holds exactly, both dust-registration states, `ctime` as a
  `Date`. Shielded: coin hashes by value over a settled wallet.

One dust case is `it.fails` deliberately: `pendingDust` is absent from the snapshot schema and the restore path passes
an empty array, so a wallet that has spent Dust offers it as available again after a restart. Left failing rather than
fixed — carrying the entry needs a way to expire it, which is a scope decision, not a test one.

Every case mutation-verified: the sharpest is a shielded wallet that cannot tell a spent coin from an unspent one,
which leaves **253 of 254** unit tests green.
