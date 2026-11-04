---
'@midnightntwrk/wallet-sdk-node-client': patch
---

fix(node-client): wait for a reconnecting socket to open before probing it

Every `PolkadotNodeClient` call made after an idle gap printed `RPC-CORE: chain(): Text:: WebSocket is not connected` at
error level and took one `reconnectionDelay` longer than it needed to: the readiness probe was sent as soon as
`connect()` resolved, which is before the socket has opened. The client now waits for the socket to open before probing,
so such a call neither logs nor waits. A call that arrives while another call's socket is still opening waits for that
same socket instead of probing early, and a connection the node refuses ends the wait and is retried like any other
failed attempt.
