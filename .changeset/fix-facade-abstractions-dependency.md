---
'@midnight-ntwrk/wallet-sdk-facade': patch
---

Fix `@midnight-ntwrk/wallet-sdk-abstractions` being declared as a devDependency despite being imported at runtime from `src/index.ts`. Consumers of the facade now correctly receive `wallet-sdk-abstractions` on install, resolving Vite/esbuild dep-optimization failures with `No matching export ... for import "TransactionHistoryStorage"`.
