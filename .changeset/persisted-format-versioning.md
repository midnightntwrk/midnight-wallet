---
'@midnightntwrk/wallet-sdk-abstractions': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
---

Version every persisted format, read what earlier releases wrote, refuse the rest with a tagged error.

### Breaking

- `finalizedBlock` is optional on `FinalizedLifecycle` and `FinalizedWalletEntry`; `isFinalizedWalletEntry` no longer
  implies one is present.
- `InMemoryTransactionHistoryStorage.restore` throws `TransactionHistoryRestoreError` instead of returning an empty
  store; `tryRestore` returns it as a `Left`.
- An unreadable snapshot is refused with `SnapshotRestoreError` (tag
  `@midnightntwrk/wallet-sdk-abstractions/SnapshotFormat/SnapshotRestoreError`), not `Wallet.Other`.
- A finalized history entry with no block is reported as `BlocklessFinalizedEntryError` (tag
  `Wallet.BlocklessFinalizedEntry`), not `TransactionHistoryError`.
- `upgradeV1ToV2` takes `readonly unknown[]`; `upgradeToCurrentFormat` returns an `Either`.

### Added

- Histories are written as `{ version: 'v2', entries }`. Snapshots carry `version: 'v1'`, or `v2` for the unshielded V2
  variant (key is `{ tag, value }`); a `v1` unshielded snapshot is upgraded on read. Unknown versions are refused by
  name.
- Snapshots carry `writtenBy: 'v1' | 'v2'`. A snapshot is restored by its writer when that variant is registered and
  the protocol version is not below the writer's activation; otherwise by protocol version. An unshielded snapshot with
  no `writtenBy` and a bare-string key counts as written by V1.
- Abstractions: `SnapshotFormat` (`versionField`, `writtenByField`, `isSnapshotWriter`, `readSnapshot`,
  `SnapshotRestoreError` with `surface`, `detectedVersion`, `reason`, `cause`), `SnapshotRouting` (`readEnvelope`,
  `routeSnapshot`), `TransactionHistoryFormat.detectVersion`; `TransactionHistoryRestoreError` carries a `reason`.
- Facade exports `finalizedTransactionTraits`; dust exports `Serialization` from `/v1`.
- CI gates persisted formats on drift, fixture coverage and frozen fixtures.

### Fixed

- Histories saved by abstractions 2.1.0 or earlier restore; each entry gains a `finalized` lifecycle and, if missing,
  empty `identifiers`.
- The `txHistory` embedded in a shielded 1.0.0 snapshot, and `coinHashesPending` written by V2, are no longer dropped by
  a reader; both survive the `forks.v9` crossing.
- A V1 snapshot saved in the fork window now migrates: booked UTXOs released, `registeredForDustGeneration` cleared,
  stranded shielded spends released. Covers earlier snapshots for unshielded, from this release on for shielded and
  dust.
- A V2 snapshot with a protocol version below V2's activation starts on V1 instead of failing with "No variant to
  init".
- `restore` throws the tagged error `tryRestore` reports, not `getOrThrow called on a Left`.
- `hasTTLExpired` applies the dust grace period only to transactions carrying shielded offers, and to transactions with
  no intents.
- `NoOpTransactionHistoryStorage.serialize` writes `{ version: 'v2', entries: [] }`.

Nothing saved by this release opens in abstractions 2.1.0.
