---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-indexer-client': minor
---

**Crossing a hard fork, the shielded wallet now carries its local state instead of starting empty.** The two ledger
versions either side of the boundary serialize a shielded wallet's local state under the same codec — the transaction
codec moved at the fork, this one did not — so the migration hands the pre-fork state's serialization straight to the
post-fork ledger's deserializer. The crossing is a round trip rather than a reconstruction: the commitment tree arrives
whole, with the wallet's coins at the Merkle indices the chain gave them, the height the tree had reached, and the
outputs the wallet was still expecting. Nothing here depends on the indexer replaying pre-fork history as new-version
events — it does not replay it, and a wallet that waited for it lost its coins.

Expected outputs matter as much as spendable coins: a wallet that has built a transfer, or taken change out of one,
is owed a coin whose commitment it knows and whose leaf is not yet on chain, and no chain announces that a second time
after a fork. Carrying the state as bytes preserves them.

A characterization test (`src/v2/test/byteCrossing.test.ts`) pins the shared codec against both real ledger modules,
including a spend built on a crossed state validating against a post-fork chain. If a future ledger major moves the
codec the failure is loud — a header-tag mismatch, surfaced as a wallet error at the migration rather than a throw —
and the fix is a ledger-shipped local-state translation dropped into the same migration seam.

Coin commitments and nullifiers are the one thing the bytes cannot carry, because deriving them needs the secret keys a
migration is not given. A migrated wallet therefore declares them pending and the first synchronization update, which
does carry keys, computes them. A snapshot written in that window declares the same thing and restores unchanged, so an
application that saves state between the fork and the next sync loses nothing. Snapshots written by earlier versions
load exactly as before.

`PreviousLedgerWallet`, the shape a wallet must present to be migrated across the boundary, now also requires the
previous wallet's local state, described by the one thing the crossing needs of it: that it can serialize itself. The
previous variant's own state object satisfies this as it is, so wallets built through the SDK are unaffected; only code
that hand-builds a migration input rather than letting the wallet layer pass the previous variant's state has to add
the field.

`@midnightntwrk/wallet-sdk-indexer-client` gains the `zswapMerkleTreeCollapsedUpdate` query, which fetches the collapsed
Merkle-tree update covering an index range, usable on its own.

The dust and unshielded crossings are unchanged and remain correct as they are: the chain itself wipes dust state at the
fork and replays it, so the dust wallet re-discovers its own through ordinary synchronization, and unshielded state is
public UTXO data carried over field for field.
