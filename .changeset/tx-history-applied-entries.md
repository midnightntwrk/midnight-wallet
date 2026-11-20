---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
---

feat: never lose a shielded or Dust tx-history entry to a failed lookup or an early snapshot

The shielded and Dust wallets now store each transaction in the history as soon as they apply it, and fill in its
details once the indexer answers, including after a restart or restore. Until then the entry is marked incomplete
(`shieldedDetailsPending` / `dustDetailsPending`), so an app can tell it apart from a finished one, whose status it may
not have yet.

What apps need to know:

- A snapshot is never ahead of its history, as long as the wallet state is serialized before the history.
- Custom history storages opt in by implementing the new optional `TransactionHistoryWriter.gotApplied`; without it they
  work as before.
- An app restoring its history with its own entry schema must declare both flags.
