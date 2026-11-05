---
'@midnightntwrk/wallet-sdk-address-format': major
---

Breaking changes since 3.x

- Built on `@midnightntwrk/ledger-v9` `1.0.0-rc.7` instead of `@midnight-ntwrk/ledger-v8`, so importing the package
  loads the ledger-v9 WASM module. `ShieldedEncryptionSecretKey` (its constructor, `zswap` and `codec.decode`) holds a
  ledger-v9 `EncryptionSecretKey`: do not hand it to ledger-v8 APIs. The Bech32m encoding of every address type is
  unchanged.
