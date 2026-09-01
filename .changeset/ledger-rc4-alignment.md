---
'@midnightntwrk/wallet-sdk-testkit': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-address-format': minor
'@midnightntwrk/wallet-sdk-prover-client': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-node-client': minor
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk': minor
---

The wallet now builds against ledger-v9 1.0.0-rc.4; requires node 2.1.0-beta.1 / indexer
4.4.0-rc.2-25da0487 era infrastructure.

This is a platform alignment, not an API change: rc.4's `ledger-v9.d.ts` is byte-identical to rc.3's, so
nothing in the TypeScript surface moves and no caller has anything to migrate. What changed is inside the
WASM — dust semantics at minimum — and that is precisely why the version has to move in lockstep with the
chain rather than being treated as a routine dependency bump.

The rc.3 wallet cannot transact against rc.4-line infrastructure. Against node 2.0.0-rc.3 with the
4.4.0-rc.2-25da0487 indexer (which is built on midnight-ledger 9.1.0.0-rc.4) the node accepts the first
fee-paying transaction and the indexer then crashes re-applying it, on a dust spend proof it computes a
different dust state for. Against node 2.1.0-beta.1 the mismatch surfaces one step earlier, at submission:
every wallet transaction is rejected with `1010: Invalid Transaction: Custom error: 170`. Both are the same
fault seen from two sides — the wallet proving on one ledger line and the chain validating on another — so
the three move together or not at all.

`@midnight-ntwrk/ledger-v8` is deliberately untouched. It is the pre-fork side of the v1/v2 twins and has
its own release line under a different npm scope; nothing about rc.4 concerns it.
