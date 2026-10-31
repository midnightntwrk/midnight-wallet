---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-testkit': major
---

refactor(shielded,capabilities,testkit)!: remove deprecated aliases before the 2.0.0 release

BREAKING CHANGE:

- `V9_NATIVE_FORK_VERSION` is removed from `@midnightntwrk/wallet-sdk-shielded`. Use
  `ProtocolVersion.V9NativeForkVersion` from `@midnightntwrk/wallet-sdk-abstractions`.
- `getBlockEventsSince` is removed from the capabilities simulators. Use `getBlockEventsFrom`.
- The testkit's `dustSnapshotPath` is removed, and saving a snapshot no longer deletes the files earlier snapshot layouts
  left behind.
