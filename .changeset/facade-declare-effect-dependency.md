---
'@midnightntwrk/wallet-sdk-facade': patch
---

Declare `effect` as a direct dependency. The facade imports from `effect` in
its source (`src/index.ts`, `src/transaction.ts`) but previously relied on the
dependency being hoisted from another workspace package, which could fail for
consumers that install the facade in isolation.
