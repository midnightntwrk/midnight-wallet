---
'@midnight-ntwrk/wallet-sdk-indexer-client': minor
'@midnight-ntwrk/wallet-sdk-capabilities': minor
'@midnight-ntwrk/wallet-sdk-facade': minor
---

- Create a pending transactions service in the `@midnight-ntwrk/wallet-sdk-capabilities` package. The service checks TTL
  and status of transactions against indexer in order to report failures. The service state is also meant to be
  serialized and restored in order to not loose track of pending transactions in case of wallet restarts
- Integrate the pending transactions service into the `WalletFacade`. It registers transactions as soon as they are
  finalized (it can't happen earlier because unproven transactions contain copies of secret keys for proving purposes).
  Whenever a pending transaction is reported as failed - it is reverted. The pending transactions service state is also
  reported in the facade state for serialization purposes and to enable UI reporting.
