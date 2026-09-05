---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-testkit': patch
---

The v9-native fork version lives with the version type: `ProtocolVersion.V9NativeForkVersion` in the abstractions
package (and through the umbrella package's `ProtocolVersion`), next to `MinSupportedVersion` and `MaxSupportedVersion`.
It is the same value the shielded package published as `V9_NATIVE_FORK_VERSION` — a property of the chain, not of one
wallet, which is why it moves. The shielded export stays as a deprecated alias of the new constant, so existing imports
keep working; it will be removed in a later release. As before, each wallet package requires `forks.v9` rather than
presetting it; the facade presets it as `DefaultForkSchedule`, the same value — see its own changeset.

`ProtocolVersion.V9NativeForkSchedule` sits next to it: the fork schedule of a chain born on ledger-v9,
`{ v9: V9NativeForkVersion }`, named once so that a configuration pointed at such a chain writes
`forks: ProtocolVersion.V9NativeForkSchedule` rather than the literal. It is the value the facade's
`DefaultForkSchedule` presets.
