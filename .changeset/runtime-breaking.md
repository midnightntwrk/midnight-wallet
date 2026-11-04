---
'@midnightntwrk/wallet-sdk-runtime': major
---

Breaking changes since 1.x

For code that implements its own variants or wallet classes.

- `Variant` requires `protocolVersionOf(state)`, the protocol version a state of the variant records. A wallet started
  from state it already holds now reports that version rather than its variant's lower bound, and never one below the
  variant's activation range. A variant whose state records no version returns `ProtocolVersion.MinSupportedVersion`,
  which starts it at its lower bound as before.
- `Variant.migrateState` may fail with `WalletRuntimeError`.
- `stateChanges` and `rawState` emit `Runtime.RuntimeState`, which carries the tag of the variant that produced the
  state.
- A wallet class (`BaseWalletClass`) has `variantFor` and `startAtVariant`.
- `VariantContext` requires `activationRange`, so code that starts a variant itself must pass one, and the `Runtime`
  interface requires `onVariantActivation`, which a hand-written fake must provide.
