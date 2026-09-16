---
'@midnightntwrk/wallet-sdk-facade': major
---

`FinalizedWalletEntry['lifecycle']['finalizedBlock']` is now optional.

A transaction history saved before the lifecycle field existed is a bare array of entries with no block recorded
anywhere. Those entries are known to have been finalized — the only writer at the time ran from the sync path, after
the indexer had returned the transaction inside a block — but which block it was is not in the payload, and the SDK
will not invent one. So an entry restored from such a history is `finalized` with no `finalizedBlock`.

Every entry the SDK writes itself still carries a block; a blockless one only ever arrives from that upgrade path.

`isFinalizedWalletEntry` narrows the lifecycle and nothing more: it does **not** imply a block is present. A dApp
reading `entry.lifecycle.finalizedBlock` after that guard must handle `undefined` — either guard on it directly, or
fetch the block from the indexer by the entry's transaction hash when it needs the height or timestamp.
