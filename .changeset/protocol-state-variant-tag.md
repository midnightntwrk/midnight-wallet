---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-runtime': minor
---

**Every state the runtime publishes now carries `variantTag`, the tag of the variant that produced it.** Read this note
if you construct a `ProtocolState` anywhere — including in tests.

`ProtocolState<TState>` becomes `ProtocolState<TState, TVariantTag extends string | symbol = string | symbol>` and
gains a **required** `variantTag` field. The type parameter is defaulted, so every existing _annotation_ still compiles;
what does not compile is a `ProtocolState` **value** built without a `variantTag`. In this repository that was only the
runtime itself plus test fixtures asserting on emitted states, and the same is expected of consumers: the wallets read
these values, they do not construct them. `ProtocolState.getEquivalence` now compares `variantTag` strictly as well, so
two states that differ only in which variant produced them are no longer equal.

Why the runtime hands it over rather than leaving it to be inferred: after a migration, the version alone identifies the
producing variant only if the reader re-derives every variant's activation range and casts its way to the matching
capabilities, on every emission. The runtime knows the answer at the moment it publishes, so it says so. Selecting the
capabilities that understand a state is now a lookup by tag.

The tag is taken from the variant whose stream the emission came from, including across a migration, so an emission can
never be attributed to a variant that did not produce it.

Also in the runtime:

- `Runtime.RuntimeState<Variants>` names the published state shape once —
  `ProtocolState<StateOf<Each<Variants>>, VariantTag<Each<Variants>>>` — and `Runtime.stateChanges`,
  `WalletLike.rawState` and the built wallet class's `rawState` all use it, so they cannot drift apart. For a wallet
  built over known variants, `variantTag` is typed as the union of exactly those variants' tags, not as
  `string | symbol`.
- `Variant.getVersionedVariantTag` is now generic over the versioned variant rather than over the variant inside it, so
  a union of versioned variants yields the union of their tags instead of collapsing to the first member's. Existing
  single-variant call sites are unaffected.
