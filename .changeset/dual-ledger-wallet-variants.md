---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk': minor
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk-testkit': patch
---

The shielded, dust and unshielded wallet packages each contain one variant per ledger version and can follow the chain
across a hard fork.

**The `./v1` subpath's contents change on this beta line.** The ledger-v9 production variant it used to export now
lives at `./v2`, with every `V1`-named export renamed to `V2` (`V1Builder` → `V2Builder`, and so on); imports of the
old names from `./v1` no longer resolve. `./v1` now holds the pre-fork ledger-v8 variant, which makes
`@midnight-ntwrk/ledger-v8` a runtime dependency: consumers of `./v1` load a second ledger WASM module, which matters
for browser bundle size. The `Simulator` namespace on `./v1` is the ledger-v8 simulator only.
`@midnightntwrk/wallet-sdk` mirrors this with `shielded/v1|v2`, `dust/v1|v2` and `unshielded/v1|v2` subpaths. Root
entry points keep their names, and serialized wallet states round-trip unchanged.

**Wallet state records the protocol version the indexer reports**, and the value only ever increases, so a reconnect
replaying older history cannot drag a wallet back across a boundary. Breaking for custom `withSync` capabilities:
`applyUpdate(state, update, activeRange)` takes the protocol-version range the running variant owns, and updates at or
beyond it must be left unapplied for the next variant. Exported helpers implement the rule; implementations that
ignore the argument keep their present behavior.

**Builders gain a migration seam** (`withMigration` / `withMigrationDefaults`) with three shipped strategies: empty
wallet (the default, unchanged), carry-over within a ledger version, and cross-ledger. Crossing a fork, each wallet
carries what its own resource requires: the shielded wallet takes its whole local state across as bytes, the dust wallet
starts on a fresh state and re-discovers its own through ordinary sync because the chain wipes and replays dust at the
fork, and unshielded state is public UTXO data carried over field for field. All three keep their identity and park their cursor at the boundary. After a migration each
wallet restarts its own background synchronization; `stop` prevents a late restart.

On `./v1`: the unshielded pre-fork variant adopts the current asynchronous signing architecture (`SigningService` /
`SignSegment`) and exports its own ledger-v8 keystore, and its deserialization now rejects a snapshot whose address
does not derive from its verifying key — snapshots written by released wallets are unaffected. The dust pre-fork
variant synchronizes by event replay only: the projections-based fast sync rests on ledger-v9-only APIs and is
permanently absent from `./v1`. The dust `./v2` fast-sync path does not yet hand over at a fork — a known, tested
limitation.

Each wallet's crossing is proven by a fork-simulation test against real ledger bytes, including negative cases; the
shielded proof also checks its result against the real v8-to-v9 state translation in the integration tier. The facade
and testkit updates are internal repoints to the renamed types.
