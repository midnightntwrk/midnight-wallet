---
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(facade): declare the `@midnight-ntwrk/ledger-v8` dependency the facade imports, so it resolves under strict package managers (pnpm, Yarn PnP) without relying on a sibling package to pull it in
