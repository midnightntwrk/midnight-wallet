---
'@midnightntwrk/wallet-sdk-node-client': patch
---

fix(node-client): await the socket close in `make()`, and reference count the shared connection

`WsProvider.disconnect()` is fire-and-forget: it dispatches the close frame and returns while the
socket is still `CLOSING`. `isConnected` only clears once `#onSocketClose` fires, so
`PolkadotNodeClient.make()` returned an api whose `isConnected` was stale-`true`.
`ensureConnection()` then treated the connection as live, skipped the reconnect, and sent on a dying
socket -- the close handshake completed milliseconds later and flushed `submitAndWatchExtrinsic` with
a disconnect error, so the transaction never reached the network. Locally the close-ack lands fast
enough to hide this; against a remote node it does not. Fixes #327.

Separately, each operation attached an unconditional `api.disconnect()` finalizer to the shared api,
so one operation completing could close the transport another was still using. Connection holds are
now reference counted and the socket closes when the last operation finishes; single-operation
behaviour is unchanged.
