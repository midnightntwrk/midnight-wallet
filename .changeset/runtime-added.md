---
'@midnightntwrk/wallet-sdk-runtime': minor
---

Additions since 1.x

- Multi-variant wallets, already possible in 1.x, can hand a variant its own configuration and range:
  `WalletBuilder.withVariant(sinceVersion, builder, configuration?)` takes a per-variant configuration, a variant learns
  its range from `VariantContext.activationRange`, `Runtime.onVariantActivation` reports each hand-over to a newly
  activated variant, and `Variant.selectByRange` picks the variant for a version.
- `StartMaterial` (in `./abstractions`) is the key material a wallet keeps so that each of its variants can derive the
  keys it needs: a seed (`fromSeed`) or per-variant key material (`forVariants`, `forVariant`), read with `auxFor`,
  `requireAuxFor`, `requireDerivedAuxFor` and `seedOf`. A variant asked to act without the key material it needs fails
  with `MissingStartAuxError`.
