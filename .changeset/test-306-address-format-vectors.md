---
---

test(address-format): refresh address test vectors and cover all address types (#306)

Updates `packages/address-format/test/addresses.json` to the vectors from
midnight-architecture#175 (adds `unshieldedAddress` and `dustAddress`, and the
corrected shielded-ESK serialization format). Removes the `zswapNetworkId`
filtering workaround and the `it.skip` on the ESK test, and adds Bech32m↔hex
round-trip coverage for every address type in the fixture (shielded address,
shielded ESK, shielded coin public key, unshielded address, dust address).
