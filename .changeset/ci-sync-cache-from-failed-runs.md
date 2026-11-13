---
'@midnightntwrk/wallet-sdk-testkit': patch
---

A wallet lifecycle released with `persist: false` now deletes the sync cache snapshot of each wallet it would have
saved, so a test that failed does not leave behind a snapshot that the next run restores and fails on again.
