---
'@midnightntwrk/wallet-sdk-address-format': patch
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-node-client': patch
'@midnightntwrk/wallet-sdk-prover-client': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-utilities': patch
'@midnightntwrk/wallet-sdk': major
'@midnightntwrk/wallet-sdk-testkit': patch
---

build: depend on the final ledger, zkir and proof server releases, all from `@midnightntwrk`

- `@midnightntwrk/ledger-v9` `^1.0.0` (was `1.0.0-rc.7`). Its key material pins are those `midnight-ledger`
  `ledger-9.1.0.0` declares, the same circuits as `ledger-9.1.0.0-rc.7`.
- `@midnightntwrk/ledger-v8` `^8.1.3` (was `@midnight-ntwrk/ledger-v8` `^8.1.0`), with the same key material as 8.1.0.
- `@midnightntwrk/zkir-v2` `^2.2.0` (was `@midnight-ntwrk/zkir-v2` `2.2.0-rc.6`).
- The testing helpers' proof server image is `9.0.0` (was `9.0.0-rc.10`).

Every Midnight package the SDK depends on now installs from the public npmjs registry, without credentials.

BREAKING CHANGE: ledger-v8 comes from `@midnightntwrk/ledger-v8`. An application that builds ledger-v8 objects and hands
them to the wallet imports them from `@midnightntwrk/ledger-v8` as well; objects from `@midnight-ntwrk/ledger-v8` belong
to a second copy of the ledger, which the wallet's own does not accept.
