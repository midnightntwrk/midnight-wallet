---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Refuse an unreadable wallet snapshot with a tagged error naming the surface, the version and the reason.

Each variant's deserializer used to map every failure to the wallet's generic error, with the format version only in
the message text, so an application restoring a snapshot could not tell "written by a newer SDK" from "corrupt"
without parsing that text. Every snapshot surface now refuses with `SnapshotRestoreError`, carrying `surface`,
`detectedVersion`, a `reason` — `unparseable`, `unknown-version` or `invalid-shape` — and the `cause`, with a `message`
that says all of it. It reaches `tryRestore` as the `Left` and `restore` as the thrown error, beside the existing
`UnsupportedSnapshotVersionError` for a protocol version no variant owns, and it is a member of each variant's
`WalletError` union.

The deserializers read through one shared `SnapshotFormat.readSnapshot` in `@midnightntwrk/wallet-sdk-abstractions`,
which parses, checks the declared format version against what the reader accepts, runs the upgrade step if there is
one, and decodes the schema. What each reader accepts and writes is unchanged.
