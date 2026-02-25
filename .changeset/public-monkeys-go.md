---
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
---

feat: add fee payment option to dust registration and handle deregistration

- Filter coins already registered for dust generation from fee payment calculations
- Add `registeredForDustGeneration` flag to `UtxoWithMeta` type
- Add docs snippets for deregistration and redesignation flows
