---
'@midnightntwrk/wallet-sdk-facade': patch
---

Keep the fields a transaction-history entry carries that this build does not know when a later update merges into
it. `mergeWalletEntries` rebuilt the entry from the fields it declares, so a transaction-history storage that keeps
such fields on the entry value lost them the first time the entry was updated, such as when a pending transaction was
finalized.
