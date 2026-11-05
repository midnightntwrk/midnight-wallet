---
'@midnightntwrk/wallet-sdk-abstractions': patch
---

Fixes and other changes since 2.x

- `InMemoryTransactionHistoryStorage` keeps the fields of a stored entry, and of the stored history, that its schema
  does not declare, and writes them back on `serialize`; 2.x dropped them on read. A top-level `__proto__` is carried as
  an ordinary field.
