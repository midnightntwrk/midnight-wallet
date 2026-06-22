---
'@midnightntwrk/wallet-sdk': major
'@midnightntwrk/wallet-sdk-address-format': major
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-node-client': major
'@midnightntwrk/wallet-sdk-prover-client': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-testkit': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
---

Migrate from `@midnight-ntwrk/ledger-v8` to `@midnight-ntwrk/ledger-v9`.

Ledger v9 changes `SigningKey`, `SignatureVerifyingKey`, and `Signature` from plain strings
(implicitly schnorr) to tagged objects (`{ tag: 'schnorr' | 'ecdsa', value }`), adding ecdsa
support alongside schnorr. Consequences for SDK users:

- `createKeystore` now takes an `UnshieldedSecretKey` (`{ kind: 'schnorr' | 'ecdsa', secret }`)
  instead of a raw `Uint8Array` seed, and `UnshieldedKeystore.getPublicKey()` /
  `PublicKey.publicKey` return the tagged `SignatureVerifyingKey`.
- Serialized unshielded wallet state now stores the verifying key together with its signature
  kind. Snapshots produced with the v8-based SDK (plain-string key) still deserialize and
  default to `schnorr`.
- Own-input extraction (used by transaction revert) compares verifying keys structurally, and
  dust generation/registration signing wraps signatures in the v9 `SignatureEnabled` marker.

Consumers must resolve `@midnight-ntwrk/ledger-v9` instead of `@midnight-ntwrk/ledger-v8`.
