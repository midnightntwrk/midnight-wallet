---
'@midnightntwrk/wallet-sdk-shielded': patch
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(shielded,dust): report a wallet syncing from a simulator as synced once it reaches the tip

The simulator sync services advanced only `appliedIndex`, so a shielded or dust wallet syncing from a `Simulator` never
reported `isConnected` or the chain tip, and `isStrictlyComplete()` (and the facade's `isSynced`) never became true.
They now record both, as the indexer sync does. A variant still waiting on blocks beyond its range is not reported
synced.
