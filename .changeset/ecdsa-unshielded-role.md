---
'@midnightntwrk/wallet-sdk-hd': minor
---

Repurpose HD derivation role 4 (previously the unused Metadata role) as `Roles.EcdsaUnshielded`. Keys for ECDSA
unshielded operations are derived under their own role, so the secret scalar is never shared with the schnorr roles
(0/1) of the same account.
