---
---

test: guard the bounded-memory sync against regression

Unit tests now fail when the backpressure on event sync, the runtime's sliding state buffer, or the early close of the
version watchers' event-id probes is undone:

- the indexer subscription's backpressure stops the source when the consumer falls `bufferSize` behind, resumes from
  the last event, and delivers every event exactly once;
- the runtime's state stream hands a lagging subscriber only the latest state and lets superseded states be
  garbage-collected;
- shielded and Dust event sync, in both variants, subscribe through the backpressured path with the configured bounds;
- the shielded and Dust version watchers' event-id probes read one answer and close their subscription before signalling;
- an indexer subscription whose deflate-compressed connection drops fails with a `ServerError` instead of stalling.

Previously, disabling backpressure or the runtime's sliding buffer left every unit test green.
