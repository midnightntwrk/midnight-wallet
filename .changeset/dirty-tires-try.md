---
'@midnight-ntwrk/wallet-sdk-address-format': patch
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
'@midnight-ntwrk/wallet-sdk-hd': patch
---

Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet initialization
methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for sync status of
whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys for multiple
roles at once
