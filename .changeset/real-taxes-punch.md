---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-shielded': patch
'@midnight-ntwrk/wallet-sdk-indexer-client': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
---

Add optional `keepAlive` config param to `SubscriptionClient.ServerConfig` and to `IndexerClientConnection` in all wallet packages. The value is forwarded to the underlying `graphql-ws` client and defaults to `15_000` ms when not provided.
