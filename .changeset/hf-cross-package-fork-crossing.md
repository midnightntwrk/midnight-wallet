---
---

test(wallet-integration-tests): cover a fork crossing built from published packages only

Test-only, no production changes. Every fork test today lives inside the package that owns the wallet and reaches for
scaffolding in that package's `src/test/`, none of which is exported. So nothing established whether an application can
assemble a wallet that crosses a fork from the published surface alone — and if it cannot, a cross-wallet fork test
needs new public exports, which is an API decision rather than a test one.

It can. The two-variant wallet is rebuilt here from public entry points only: `WalletBuilder.init()` from the runtime
package, `wallet-sdk-shielded/v1` and `/v2`, and the simulator re-exported from `wallet-sdk-capabilities/simulation`.
The handover runs the ledger team's real v8-to-v9 translation. This matters because the shipped `ShieldedWallet`
registers exactly one variant and its type is a one-element HList throughout, so the class itself cannot express a
wallet that crosses a fork; `WalletBuilder` is the public way to say it.

Adds the package's `turbo.json`, which it did not have — `test:integration` now depends on
`@midnightntwrk/wallet-sdk-state-translation#build:wasm`, matching `capabilities` and `shielded-wallet`, so the
artifact is built before the tests rather than the ordering being left to CI. Also adds the two dependencies the file
needs and the package lacked: `@midnight-ntwrk/ledger-v8` and the state-translation workspace package.

Mutation-verified, and each case dies to its own mutation and survives the other. Replacing the translation with an
identity function fails both. Deriving the post-fork keys from a different seed fails only the identity case. Funding
the pre-fork chain with nothing fails only the carry case, which is what makes its non-empty guard load-bearing rather
than decorative.

Scoped deliberately to shielded. Dust and unshielded are not missing integration companions — both harnesses document
why they need none: dust replays byte-identical event payloads and is directly comparable without any translation, and
the unshielded timeline is itself the indexer wire format, with no ledger encoding in the path to be unfaithful to.
Only shielded re-mints equivalent coins, so only shielded needs the translation as a fidelity oracle.
