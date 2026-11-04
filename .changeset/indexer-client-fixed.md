---
'@midnightntwrk/wallet-sdk-indexer-client': patch
---

Fixes and other changes since 1.x

- The subscription WebSocket stays open for the client's lifetime, so a subscription that pauses for backpressure
  resumes on the same connection instead of reconnecting; disposing the client closes the socket and cancels its
  keep-alive timer.
