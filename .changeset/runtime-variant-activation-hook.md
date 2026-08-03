---
'@midnightntwrk/wallet-sdk-runtime': minor
---

Add the runtime machinery a hard-fork variant handoff needs: a variant-activation hook and a registration-derived
activation range on the variant start context.

`Runtime.onVariantActivation(impl)` registers a poly-function watcher that is notified with the running variant that
became current after a migration — and never for the variant the runtime started with. It exists so work that lives
outside the runtime state, most importantly background synchronization started with the application's secret keys, can
be re-established on the newly activated variant instead of leaving it idle. The returned effect completes only once the
watcher is subscribed, so an activation triggered immediately afterwards cannot be missed; a failing watcher neither
affects the runtime nor unsubscribes itself.

`Variant.VariantContext` gains a required `activationRange: ProtocolVersion.Range` — the half-open
`[sinceVersion, nextVariantSinceVersion)` window the runtime already derives from `withVariant` registration, now handed
to the variant so migration boundaries and any version-boundary logic inside a variant cannot disagree with
registration. This is a breaking change only for code that constructs a `VariantContext` and calls `Variant.start`
directly, which is not part of the normal wallet lifecycle.

`Variant.migrateState` may now fail with `WalletRuntimeError` (the error channel was `never`); such a failure already
surfaced on the state stream at runtime, and the contract now says so. Existing implementations remain valid.
