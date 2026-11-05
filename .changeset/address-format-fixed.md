---
'@midnightntwrk/wallet-sdk-address-format': patch
---

Fixes and other changes since 3.x

- `MidnightBech32m.parse` accepts addresses longer than 90 characters again. From `@scure/base` 2.4.0, Bech32m decoding
  rejects strings over 90 characters by default, so every shielded address (124 characters on mainnet, more on other
  networks) failed with `invalid string length`. The package now depends on `@scure/base` `^2.4.0` and decodes without
  that limit; each address type still checks its own payload length.
- Decoding a shielded address whose payload is not 64 bytes, or a shielded encryption public key that is not 32 bytes,
  now throws instead of returning a malformed key. The same check applies to `ShieldedEncryptionPublicKey.fromHexString`
  and the `ShieldedEncryptionPublicKey` constructor.
