---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': minor
---

Enforce signature-scheme consistency (schnorr vs ecdsa) for unshielded wallets. A new `SchemeMismatchError` and pure
guards reject mixed schemes early: signing rejects a signature whose scheme differs from the input owners before it is
attached (no partially-signed transaction reaches the network), and deserialization rejects a snapshot whose verifying
key encoding does not match its tag or whose stored address does not derive from its key.
