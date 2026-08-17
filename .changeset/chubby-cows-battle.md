---
'@midnightntwrk/wallet-sdk-address-format': minor
---

Register Bech32m codecs on ShieldedEncryptionSecretKey, ShieldedCoinPublicKey, and ShieldedEncryptionPublicKey, so all
three can be encoded and decoded through the generic MidnightBech32m helpers rather than only through their own codec
properties.
