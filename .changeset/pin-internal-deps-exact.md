---
'@midnightntwrk/wallet-sdk': patch
'@midnightntwrk/wallet-sdk-capabilities': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk-indexer-client': patch
'@midnightntwrk/wallet-sdk-node-client': patch
'@midnightntwrk/wallet-sdk-prover-client': patch
'@midnightntwrk/wallet-sdk-runtime': patch
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-testkit': patch
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
---

Pin internal `@midnightntwrk/wallet-sdk-*` dependencies to exact versions instead of caret ranges. A caret range on a prerelease base (e.g. `^5.0.0-beta.0`) satisfies canary snapshots published on the same `major.minor.patch` (`5.0.0-canary.*`), and since `canary` sorts above `beta`/`alpha`, installing a prerelease pulled canary builds of the sibling packages. Exact pins make published releases resolve to a single coherent set regardless of what snapshots exist on the registry.
