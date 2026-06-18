---
'@midnightntwrk/wallet-sdk-indexer-client': patch
---

Fix a fiber/memory leak in the WebSocket subscription stream. At the indexer's sustained
~1k msg/sec push rate, `Stream.async` was forking a top-level fiber per emit (via
`Runtime.runPromiseExit`) and accumulating them in Effect's `Global.roots`. Switched to
`Stream.asyncPush`, which writes straight to an internal queue and ties teardown to the
surrounding scope via `Effect.acquireRelease`. Also preserves the full GraphQL error
array as `cause` on `ClientError` and joins all error messages instead of dropping all
but the first.
