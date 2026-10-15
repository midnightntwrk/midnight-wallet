---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

refactor(dust): remove `RunningV1Variant.sync`

The V1 variant synchronizes in the background only. A one-pass `sync` needs a sync service that ends, and the only one
a dust wallet has is the projections service, which no published ledger-v8 can support. The method was added during the
5.0.0 pre-releases and never shipped in a stable release.
