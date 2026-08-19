---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Add `ProtocolVersion.Registry<T>`: values keyed by protocol version ranges, with a total selection.

The SDK asks the same question in several places — which codec decodes a block, which prover proves a recipe, which
transaction trait understands a pending transaction, which variant a snapshot restores into. All of them are "pick the
implementation that speaks this protocol version", and each answering it for itself is how two of them come to disagree
about where a boundary lies. This is that question, once.

- `ProtocolVersion.Registry<T>` / `ProtocolVersion.RegistryEntry<T>` — an ordered, non-overlapping map from half-open
  version ranges to values. `ProtocolVersion.emptyRegistry` is the empty one.
- `ProtocolVersion.makeRegistry(entries)` takes entries that carry their own ranges;
  `ProtocolVersion.makeRegistryFromActivations(activations)` takes the "since this version" shape registration already
  has everywhere in the SDK and derives the ranges from it — entry _i_ serves
  `[sinceVersion(i), sinceVersion(i + 1))`, the last one runs to `MaxSupportedVersion`. Both return an `Either`, failing
  with `ProtocolVersion.RegistryError` when the versions are not strictly ascending, when ranges overlap, or when the
  last activation leaves no room for a range above it.
- `ProtocolVersion.select(registry, version)` and `ProtocolVersion.selectEntry(registry, version)` return an `Option`.
  Selection is total: a version no entry covers is a `none`, never a throw, so callers decide what a miss means in their
  own domain — an unsupported snapshot version is not the same failure as an unsupported proving version.

Ranges keep the existing half-open semantics of `withinRange`: the start is included, the end is not.

Purely additive; nothing that compiled before changes.
