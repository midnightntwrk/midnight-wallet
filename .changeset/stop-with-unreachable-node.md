---
'@midnightntwrk/wallet-sdk-node-client': patch
'@midnightntwrk/wallet-sdk-capabilities': patch
---

fix(node-client,capabilities): let a wallet whose node is unreachable be stopped

`facade.stop()` never settled when the node had not answered since the facade was built: the default submission
service's `close()` waited for a connection that never came, and the provider kept retrying for the life of the process.
`PolkadotNodeClient.make` can now be interrupted while it waits for the node, and an attempt that ends without a client
disconnects its provider. The submission service's `close()` interrupts a connection still in progress instead of waiting
for it, and a submission made after that fails with a `SubmissionError`. A `ConnectionError` for a connection that
outlasted a finite `reconnectionTimeout` now carries Effect's `TimeoutException` as its `cause`.
