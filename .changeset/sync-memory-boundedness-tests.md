---
---

test: guard the bounded-memory sync against regression

Unit tests now fail when any of the mechanisms that keep sync memory bounded is undone:

- the indexer subscription's backpressure stops the source when the consumer falls `bufferSize` behind, resumes from
  the last event, and delivers every event exactly once;
- the runtime's state stream hands a lagging subscriber only the latest state and lets superseded states be
  garbage-collected;
- shielded and Dust event sync, in both variants, subscribe through the backpressured path with the configured bounds.

Previously, disabling backpressure or the runtime's sliding buffer left every unit test green.
