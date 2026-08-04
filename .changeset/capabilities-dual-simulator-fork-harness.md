---
'@midnightntwrk/wallet-sdk-capabilities': minor
---

Add a dual-ledger simulator and a fork harness, so wallet behaviour across a hard fork can be tested against real ledger
bytes on both sides of the boundary.

The `simulation` entry point now holds one simulator per ledger version. The existing ledger-v9 simulator is joined by a
pre-fork ledger-v8 twin — the same simulator over the other ledger, so a chain on either side of the fork is driven with
the same API. Each is reachable by version, as `V8` and `V9`, and the v9 names stay exported unqualified, so existing
code is unaffected. This makes `@midnight-ntwrk/ledger-v8` a runtime dependency of this package: consumers now install
two ledger WASM modules, which matters for browser bundle size.

Both simulators now carry a protocol-version timeline. `SimulatorConfig.protocolVersion` sets the version a chain starts
on, every produced block records the version it was produced under, and `Simulator.setProtocolVersion(version)` /
`Simulator.scheduleFork(atBlock, version)` change it — immediately, or at a chosen block height. `Block` and
`SimulatorState` gain a `protocolVersion` field. `Simulator.produceEmptyBlock()` produces a block without a transaction,
so a chain can be advanced to a given height. No protocol version is built in: the version a fork activates is always
supplied by the caller.

`ForkSimulator` composes the two into a single chain that crosses a fork. It runs the pre-fork chain up to the
configured fork block, stamps that block with the fork version — the signal a wallet's pre-fork variant migrates on —
and then constructs the post-fork chain, numbered so that the boundary height is re-delivered with post-fork content.
How value crosses the boundary is the `ForkHandover` seam: `ForkHandover.ReMint` recreates it from the final pre-fork
state (what tests use today, and what a resync-style wallet migration expects), while `ForkHandover.MigrateLedger`
supplies a converted post-fork ledger directly and is where a ledger-provided v8-to-v9 state migration will drop in.
