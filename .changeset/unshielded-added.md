---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

Additions since 3.x

- **ECDSA unshielded keys** on ledger-v9 (the V2 variant), beside schnorr. A wallet's scheme is enforced: a signature in
  the other scheme is refused before it is attached (`SchemeMismatchError` on V2), so no partially signed transaction
  reaches the network. `UnshieldedWalletState.verifyingKey` reports the wallet's key in the SDK's `{ tag, value }` shape
  on either variant.
- **Following the chain across the v9 fork.** At the crossing every UTxO is carried, and bookings of transactions still
  pending return to the available balance. Night UTxOs cross with `registeredForDustGeneration: false`, matching what
  the indexer reports, so re-register them on ledger-v9. The protocol version is read off the sync's progress and only
  increases.
- **Restoring.** A snapshot restores on the variant that wrote it. `UnshieldedWallet(configuration).tryRestore` returns
  an `Either` instead of throwing, and the `UnshieldedRestore` namespace inspects a snapshot. Snapshot fields this build
  does not declare are kept and written back.
- **Bookings.** A booking carries its transaction's TTL. `revertUtxos(ids)` releases booked coins by id,
  `releaseRestoredPending(coveredIds)` releases bookings restored from a snapshot that no live transaction covers, and
  `revertFailedSegments(tx, failedSegments)` releases the failed segments of a partially successful transaction.
  `makeDefaultV1SerializationCapability` and `makeDefaultV2SerializationCapability` take an optional `{ clock }`.
- **`BridgeClaimTransaction`** is synced, as an implicitly successful transaction.
- **Composition and configuration.** A `./v2` subpath (the ledger-v9 variant) beside `./v1`; both export `Migration`,
  `Signing` and `coreStateOf`, and their builders gain `withMigration(Defaults)` and `withSigning(Defaults)`.
  `CustomForkingUnshieldedWallet` composes both variants from your own builders. The root exports
  `UnshieldedWalletTypes`, `SignSegment`, `UnshieldedSecretKey`, `DefaultUnshieldedSyncConfiguration`,
  `NodeClientConnection` and `resolveNodeEndpoint`.
