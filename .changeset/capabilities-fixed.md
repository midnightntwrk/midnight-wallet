---
'@midnightntwrk/wallet-sdk-capabilities': patch
---

Fixes and other changes since 3.x

- Closing the default submission service no longer waits for a node that never connected: `close()` interrupts a
  connection still in progress, and a submission made after that fails with a `SubmissionError`.
- The stored transaction set keeps the top-level fields this build does not declare, and writes them back.
