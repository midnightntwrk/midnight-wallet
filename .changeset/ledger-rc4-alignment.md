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

The rc.3 and rc.4 ledger lines are not proof-compatible for dust. rc.4 (`a5a01fc7`, "Improve dust circuit and
validation") changed the dust `spend` circuit itself — the spend now binds the spent UTXO's nonce and the generation
info to a shared initial nonce, so the verifier key changed — and every rc.4 verifier (node `2.1.0-beta.1`, indexer
`4.4.0-rc.2-25da0487`) rejects a proof made against the rc.3 circuit with `Malformed(InvalidDustSpendProof)`. Because
the SDK's HTTP prover sends only the proof preimage and the proof server resolves `midnight/dust/spend` from keys
compiled into its own binary, the proof server's build decides which circuit a wallet proves against. Proof-server
image tags do not track ledger tags: `9.0.0-rc.4` was published 2026-07-02, five weeks before the circuit change; the
rc.4 ledger tag declares proof-server `9.0.0-rc.7` (published 2026-08-11). Pairing the rc.4 wallet with proof-server
`9.0.0-rc.7` makes every smoke transfer pass against node `2.1.0-beta.1`; every local proof-server pin in this repo
(the e2e compose file, the prover-client and wallet-integration-tests fixtures, the shared testcontainers helper) is
moved accordingly. Nothing in the wallet's own dust arithmetic or spend construction was at fault.

`@midnight-ntwrk/ledger-v8` is deliberately untouched. It is the pre-fork side of the v1/v2 twins and has
its own release line under a different npm scope; nothing about rc.4 concerns it.
