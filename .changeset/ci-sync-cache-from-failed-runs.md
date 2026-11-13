---
'@midnightntwrk/wallet-sdk-testkit': patch
---

A wallet lifecycle released with `persist: false` now deletes the sync cache snapshot of each wallet it would have
saved, including a wallet that was still starting, so a test that failed does not leave behind a snapshot that the next
run restores and fails on again. Pass the new `willRetry(context)` as `willRetry` to keep the snapshots of a failed
attempt that vitest will run again; the dust and token-transfer healthchecks do. The dust healthcheck now saves its
wallet as `dust-<seed>-<network>.state`, apart from the token-transfer healthcheck's snapshot of the same seed, so its
first run after upgrading builds that wallet from scratch.
