---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

Enforce signature-scheme consistency (schnorr vs ecdsa) for unshielded wallets. A new `SchemeMismatchError` and pure
guards reject mixed schemes early: signing rejects a signature whose scheme differs from the input owners before it is
attached (no partially-signed transaction reaches the network), and deserialization rejects a snapshot whose stored
address does not derive from its verifying key (a relabelled key whose encoding does not match its tag fails to decode).
