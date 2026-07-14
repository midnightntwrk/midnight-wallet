---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

tx-history: migrate pre-`lifecycle` payloads on restore and add a versioned envelope

`InMemoryTransactionHistoryStorage.restore` now reads payloads written by abstractions ≤ 2.1.0 —
which predate the required `lifecycle` field and may omit `identifiers` — by synthesizing both on read
from the entry's existing `status`/`timestamp`. `serialize` now emits a `{ version, entries }`
envelope; `restore` accepts both the envelope and legacy bare-array payloads, so every future schema
change has an explicit version to migrate from.
