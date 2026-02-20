---
'@midnight-ntwrk/wallet-sdk-dust-wallet': major
'@midnight-ntwrk/wallet-sdk-facade': major
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-indexer-client': patch
---

fix: redesignation by spending existing dust coins during re-registration

When redesignating a Night UTXO (re-registering it for dust generation), any existing dust coins associated with those UTXOs are now properly spent as part of the transaction. Previously, redesignation would fail because these coins were left unspent.

**Breaking changes:**

- `WalletFacade.registerNightUtxosForDustGeneration` and `deregisterNightUtxosFromDustGeneration` now require a `dustSecretKey: DustSecretKey` parameter.
- `UtxoWithMeta.meta` now requires `registeredForDustGeneration: boolean` and accepts an optional `initialNonce?: string` field.
- `TransactingCapability.createDustGenerationTransaction` now accepts `state` and `dustSecretKey` parameters and returns `Either<[UnprovenTransaction, TState], WalletError>` instead of `Either<UnprovenTransaction, WalletError>`.
