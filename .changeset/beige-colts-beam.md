---
'@midnight-ntwrk/wallet-sdk-indexer-client': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
---

feat: expose Terms and Conditions via `WalletFacade.fetchTermsAndConditions`

Adds a new `FetchTermsAndConditions` GraphQL query to `@midnight-ntwrk/wallet-sdk-indexer-client` that retrieves the current Terms and Conditions (URL and SHA-256 hash) from the network indexer.

Exposes a new static method `WalletFacade.fetchTermsAndConditions(configuration)` in `@midnight-ntwrk/wallet-sdk-facade` that wallet builders can call before or independently of wallet initialization to obtain the T&C URL for display and the hash for content verification. The method accepts any configuration that includes `indexerClientConnection.indexerHttpUrl`, so the shared wallet configuration can be passed directly without adaptation.
