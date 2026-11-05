---
'@midnightntwrk/wallet-sdk-hd': major
---

Breaking changes since 3.x

- `Roles.Metadata` is removed: role 4 is now `Roles.EcdsaUnshielded`, which derives ECDSA unshielded keys. Code that
  names `Roles.Metadata` must name `Roles.EcdsaUnshielded`, or the value `4`.
