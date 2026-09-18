---
---

test(wallets): replay snapshots written by the last ledger-v8 release

Test-only. Every serialization test in the suite round-trips a snapshot this code wrote a moment earlier, which cannot
see a format that drifted between releases: writer and reader move together, so both sides are wrong in the same way
and agree. Nothing read a snapshot a real release produced.

`scripts/cross-release-corpus` pins the last SDK release on the ledger-v8 line, generates fixtures with it, and writes them into
each wallet's own `test/fixtures/cross-release/` beside a `provenance.json` naming the exact versions that produced
them. It is deliberately outside the workspace: that release cannot also be a workspace dependency, because the
workspace is its successor, and the repository's own build must never reach the import path or the corpus would only
prove the current code agrees with itself.

Five fixtures so far — empty and funded for unshielded and shielded, empty for dust. A funded Dust snapshot needs a
real dust chain driven through that release's simulator, since a Dust UTXO and its generation entry come from a
registration rather than from construction; noted in the test rather than left silent.

Mutation-verified: a reader that stops accepting the ledger-v8 creation-time encoding leaves **257 of 261** unit tests
green, failing only the corpus cases — every round-trip test in the package passes it.
