---
---

test(dust-wallet,shielded-wallet): pin the snapshot envelope on both sides of the fork

Test-only. Each wallet's serialization tests round-trip a snapshot, and a round trip cannot see a rename applied to
both the writer and the reader — the very change that stops one variant reading the other's snapshot. These pin the
envelope's shape directly: the field set on each variant, that the two agree, and that each field is encoded the way
the reader expects, with the ledger blob left opaque.

Mutation-verified: renaming the dust envelope's `offset` field to `cursor` in both the schema and its reader leaves
**234 of 237** unit tests green — every round-trip test passes — and fails only the new pins.
