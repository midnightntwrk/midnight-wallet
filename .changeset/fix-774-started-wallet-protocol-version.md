---
'@midnightntwrk/wallet-sdk-runtime': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

fix: report the protocol version a restored or probe-started wallet's state records (#774)

A wallet started from a state it already held (every `restore`/`tryRestore`, and every fresh start with a
`chainVersionProbe` configured) reported its variant's lower bound instead of the chain's version, and never corrected
it: on ledger-v8 it reported `0`, on ledger-v9 `forks.v9`. The wrong value reached `WalletFacade.activeProtocolVersion`
and the `protocolVersion` stamped on every recipe and transaction the facade built. Such a wallet now reports the version
its state records, as a wallet that crossed the boundary by hand-over always did.

**Breaking (runtime):** `Variant` requires `protocolVersionOf(state)`, returning the protocol version a state of the
variant records. The runtime reads it when it starts a variant from existing state, and never reports a version below
the variant's activation range. A variant whose state keeps no version answers `ProtocolVersion.MinSupportedVersion`,
which starts it at its lower bound as before. The variants of the unshielded, shielded and dust wallets implement it.
