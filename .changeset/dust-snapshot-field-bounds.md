---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): refuse a dust snapshot holding values the wallet cannot use

A dust snapshot with an out-of-range or malformed value in a `pendingDust` entry used to restore, and then every sync
threw while settling the entry and retried forever, with nothing able to remove it. Restore now refuses such a snapshot
with `SnapshotRestoreError` (`invalid-shape`), on both variants.

A pending entry's `nullifier`, `owner` and `nonce` must be field elements, `initialValue` a u128, `mtIndex` a u64, `seq`
a whole u32, and `backingNight` 32 bytes of hex: the bounds the ledger reads them in. At the top level,
`publicKey.publicKey` must be a field element; `offset` must fit the signed 32-bit integer the indexer takes as the
position sync resumes from; and `protocolVersion` must lie from `MinSupportedVersion` up to, but not including,
`MaxSupportedVersion`, the range some variant runs. `networkId` stays any string, so snapshots of custom networks still
restore.

This is a patch: every snapshot refused now is one the wallet could never have synced from, and every snapshot the
wallet itself writes meets these bounds.
