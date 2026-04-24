# Archived Release Notes

These notes are kept for historical reference. They predate the
[`@midnight-ntwrk/wallet-sdk`](../../packages/wallet-sdk) barrel package and follow an older versioning scheme.

## Old scheme

The filename version (`v1.0.0.md`, `v2.0.0.md`, `v3.0.0.md`) tracked
[`@midnight-ntwrk/wallet-sdk-facade`](../../packages/facade), which was the de-facto consumer entry point at the time —
most integrations depended on the facade directly and imported everything through it.

## Why it changed

When the barrel package `@midnight-ntwrk/wallet-sdk` shipped at 1.0.0, it became the recommended install path for
consumers (one install, one import surface, sub-path exports for each sub-package). Release notes were switched to track
the barrel version going forward so the filename matches the version users actually install.

The facade is still released independently — its per-release version is visible inside each note's **Packages** table —
it just no longer drives the release-note filename. See [../README.md](../README.md) for the current convention.
