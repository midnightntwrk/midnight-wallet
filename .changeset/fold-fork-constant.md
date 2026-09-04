---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-testkit': patch
---

The v9-native fork version lives with the version type: `ProtocolVersion.V9NativeForkVersion` in the abstractions
package (and through the umbrella package's `ProtocolVersion`), next to `MinSupportedVersion` and `MaxSupportedVersion`.
It is the same value the shielded package published as `V9_NATIVE_FORK_VERSION` — a property of the chain, not of one
wallet, which is why it moves. The shielded export stays as a deprecated alias of the new constant, so existing imports
keep working; it will be removed in a later release. As before, it is a named value and not a default: every wallet's
`forkVersion` remains required.
