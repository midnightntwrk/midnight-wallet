---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded-wallet): report a wallet synced on a chain with no zswap events

A shielded wallet on a chain whose zswap commitment tree is still empty, such as a fresh devnet or local chain with no
shielded outputs, now reports synced. Only a delivered zswap event used to connect the wallet, so
`progress.isStrictlyComplete()`, and with it the facade's `isSynced`, never became true on such a chain. The version
watch now reports an empty tree on every check, whatever version the chain is on, and that report connects a wallet
that has read nothing; once the event timeline has shown the wallet any event, the report changes nothing. The first
check now runs as sync starts instead of one `versionWatch.intervalMs` later, so such a wallet reports synced after a
single indexer query. With the version watch turned off (`intervalMs` of zero or less), a wallet on such a chain still
never reports synced.
