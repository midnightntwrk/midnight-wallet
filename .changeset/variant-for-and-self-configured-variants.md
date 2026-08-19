---
'@midnightntwrk/wallet-sdk-runtime': minor
---

Two additions the wallet layer needs before it can register more than one variant.

**Resolving a variant from a protocol version.** `BaseWalletClass.variantFor(version)` returns the registered versioned
variant whose activation range contains `version`, as an `Option`; `Variant.selectByRange(variants, version)` is the
same resolution over a plain array. Ranges come from `ProtocolVersion.makeRegistryFromActivations`, which is also what
the runtime derives `VariantContext.activationRange` from, so the boundary a caller resolves against and the boundary
the runtime migrates at are computed the same way. A version below the first registration selects nothing rather than
throwing: a snapshot written by an unsupported protocol version is an answer a caller has to handle, not a defect. The
resolved variant's tag addresses the never-yet-called `start(WalletClass, tag, state)`.

**Variants that carry their own configuration.** `withVariant` gains a third argument:

```ts
withVariant(sinceVersion, variantBuilder, configuration);
```

A variant registered this way is built from that configuration and **leaves the build-time intersection entirely** —
`build` then asks only for what the remaining variants still need, and asks for nothing at all when every variant is
self-configured. `VariantBuilder.SelfConfiguredVariantBuilder<TBuilder>` and `VariantBuilder.PendingConfigurationOf<T>`
express this in the types, and `VariantBuilder.AnyVersionedVariantBuilder` is now the union of the two registration
shapes.

This exists because a wallet spanning a protocol boundary has two variants that mean different, mutually unassignable
things by the same configuration key — a `simulator` or a `dustParameters` belonging to one ledger or the other.
Intersecting those produces a configuration no single variant can consume, which is why the fork test harnesses in the
wallet packages route around the builder's configuration altogether today. The two-argument `withVariant` is unchanged.
