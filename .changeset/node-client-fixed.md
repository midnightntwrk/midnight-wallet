---
'@midnightntwrk/wallet-sdk-node-client': patch
---

Fixes and other changes since 1.x

- A transaction submitted right after `PolkadotNodeClient.make()` no longer fails with a disconnect error. `make()`
  returned while the socket it had closed still reported `isConnected`, so the next call skipped the reconnect and sent
  on a dying socket; it now waits for the close to complete (#327).
- Operations that share one connection count their holds, and the socket closes when the last one finishes: one
  operation completing no longer closes the connection another is still using.
- Connection and RPC failures are typed `ConnectionError`s rather than defects, including a node URL that is not `ws://`
  or `wss://`. A finite `reconnectionTimeout` also bounds the initial connection, failing with a `ConnectionError` whose
  `cause` is Effect's `TimeoutException`.
- `make()` can be interrupted while it waits for the node, and an attempt that ends without a client disconnects its
  provider, so a wallet whose node never answers can be stopped.
- Each of the client's calls waits for the socket to open before using it, so they work right after `make()`, and a call
  after an idle gap no longer waits an extra `reconnectionDelay`. A node that accepts the socket but fails three
  readiness probes in a row is reported as a `ConnectionError`.
