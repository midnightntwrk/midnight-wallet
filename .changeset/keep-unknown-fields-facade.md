---
'@midnightntwrk/wallet-sdk-facade': patch
---

Keep the fields a transaction-history entry carries that this build does not know when a later update merges into
it. `mergeWalletEntries` rebuilt the entry from the fields it declares, so an entry restored from a later release's
history lost those fields the first time it was updated, such as when a pending transaction was finalized.
