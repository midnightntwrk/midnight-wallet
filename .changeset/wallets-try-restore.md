---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

Adds `tryRestore` beside `restore` on all three wallet classes, returning `Either` rather than throwing.

`restore` is unchanged and remains right for a snapshot the application has just written itself, where a failure is a
bug. It is the wrong shape for one it has not — a snapshot a user supplied, or one written by a build of the SDK that is
no longer the one running — where "I cannot read this" is an ordinary answer. It is also lossy: the exception `restore`
raises carries none of the reason, which is the whole point of the additive shape.

The error is named per package (`ShieldedRestoreError`, `DustRestoreError`, `UnshieldedRestoreError`) because all three
reach an application through one barrel, and covers both failures the restore path already produces: a protocol version
no registered variant reads, and bytes the variant that owns them cannot make sense of. `restore` is now stated as
`tryRestore` with the reason thrown away, so the two cannot come to disagree about which snapshots are readable.
