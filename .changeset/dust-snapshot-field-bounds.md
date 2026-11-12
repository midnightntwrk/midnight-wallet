---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): refuse a dust snapshot holding values the ledger cannot use

A dust snapshot with an out-of-range or malformed value in a `pendingDust` entry used to restore, and then every sync
threw while settling the entry and retried forever, with nothing able to remove it. Restore now refuses such a snapshot
with `SnapshotRestoreError` (`invalid-shape`), on both variants. A pending entry's `nullifier`, `owner` and `nonce` must
be field elements, `initialValue` a u128, `mtIndex` a u64, `seq` a whole u32, and `backingNight` 32 bytes of hex. At the
top level, `publicKey.publicKey` must be a field element, `offset` a u64, and `protocolVersion` within the range a
protocol version may take. Every snapshot the wallet itself writes already meets these bounds, so no valid snapshot is
refused.
