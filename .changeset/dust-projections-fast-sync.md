---
'@midnightntwrk/wallet-sdk-dust-fast-sync': minor
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk-address-format': patch
'@midnightntwrk/wallet-sdk-capabilities': patch
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
'@midnightntwrk/wallet-sdk-testkit': patch
---

Add projections-based ("fast") dust synchronization as the new `@midnightntwrk/wallet-sdk-dust-fast-sync` package.

The fast sync recovers a dust wallet from indexer projections (generation events, nullifier transactions, collapsed
merkle-tree updates) instead of replaying every ledger event. It requires ledger APIs that only exist in
`@midnight-ntwrk/ledger-v8@8.2.0-rc.1`, so the new package carries that dependency in isolation (as the
`@midnight-ntwrk/ledger-v8-rc` npm alias) while every other SDK package stays on ledger `8.1.0`. Wallet state crosses
between the two loaded ledger modules as serialized bytes — the serialization format is identical in both versions.

Supporting changes:

- `indexer-client`: new `DustGenerationEvents` and `DustNullifierTransactions` subscriptions, the
  `DustCommitmentMerkleTreeUpdate` query, and extra dust fields on `BlockHash`.
- `dust-wallet`: `stepSync` on the wallet API for manually driven sync passes, schema-based `BlockData` with the dust
  merkle-tree metadata, and `blockData(height)` support.
- `facade`: `doSync` and the optional `manualSync` flag on `start`, for driving the dust wallet sync explicitly.
- `address-format`: `hexString` getter on `DustAddress`.
- `unshielded-wallet`/`capabilities`: handle the indexer's `BridgeClaimTransaction` transaction type.
- `testkit`: include sync status in the unshielded coin-update wait log.
