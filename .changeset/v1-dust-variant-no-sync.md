---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

refactor(dust): remove `RunningV1Variant.sync`

The V1 variant now synchronizes in the background only. `sync` ran one pass and waited for it to end, which only a sync
service whose passes end allows, and the only one the SDK ships is the projections service, which needs ledger-v9. A V1
variant built with a custom finite service through `withSync` can no longer be stepped. The method was added during the
5.0.0 pre-releases and never shipped in a stable release.
