# Release Notes

This directory contains per-release notes for the Midnight Wallet SDK.

## Versioning convention

Files are named `v<major>.<minor>.<patch>.md` and the version tracks
[`@midnight-ntwrk/wallet-sdk`](../packages/wallet-sdk) — the barrel package that re-exports every other wallet SDK
package. That is the version a consumer sees when they `npm install @midnight-ntwrk/wallet-sdk`, so aligning the
release-note filename with it keeps the two easy to correlate.

Individual package versions (facade, shielded, dust, etc.) are enumerated inside each release note's **Packages** table
— they remain fully discoverable, they just aren't what the filename tracks.

## Archive

Notes written before the barrel package existed tracked `@midnight-ntwrk/wallet-sdk-facade` instead. They have been
moved to [`archive/`](archive/) — see [archive/README.md](archive/README.md) for the details of that older scheme.
