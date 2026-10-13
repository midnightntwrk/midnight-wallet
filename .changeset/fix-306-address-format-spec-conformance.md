---
'@midnightntwrk/wallet-sdk-address-format': patch
---

fix(address-format): reject shielded addresses that are not 64 bytes (#306)

`ShieldedAddress.codec.decode` now rejects a payload that is not exactly 64 bytes: a 32-byte coin public key followed
by a 32-byte encryption public key. The `ShieldedEncryptionPublicKey` constructor now rejects anything but 32 bytes,
as the coin public key already did. So `ShieldedEncryptionPublicKey.equals` given a hex string of the wrong length now
throws instead of returning `false`, matching `ShieldedCoinPublicKey.equals`. Before this change, a malformed address
passed decoding, so an application checking user input would accept it, and the problem only surfaced as a ledger
error once a transfer to it was built. Addresses the wallets derive are unaffected: both ledgers produce 32-byte
encryption public keys.
