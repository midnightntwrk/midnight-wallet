---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-shielded': patch
'@midnight-ntwrk/wallet-sdk-prover-client': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-utilities': patch
---

Performance improvement: Shielded and Dust wallet now send events in batches of 50 or after 10 seconds if total events
has not reached 50
