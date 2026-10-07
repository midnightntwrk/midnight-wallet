---
'@midnightntwrk/wallet-sdk-indexer-client': minor
---

feat(indexer-client): adopt the indexer's `graphql-transport-ws+deflate` subscription compression (#462)

Subscriptions now negotiate the indexer's deflate subprotocol (indexer >= 4.4.0), so payloads at or above the server's
256 B threshold arrive as zlib binary frames and are inflated client-side. Compression is always on with no public
configuration; against an indexer that predates the subprotocol the client silently falls back to standard
`graphql-transport-ws`.

The WebSocket connection is also now held open for the client's entire lifetime (`lazy: false`), so backpressure
pause/resume cycles reuse a single physical connection instead of reconnecting each time, and disposing the client
leaves nothing pending — no timers survive to delay the exit of a short-lived process.
