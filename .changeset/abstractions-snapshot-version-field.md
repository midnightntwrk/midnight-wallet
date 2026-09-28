---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

Add `SnapshotFormat.versionField`, the one declaration of a snapshot's `version` field.

Each wallet's snapshot schema used to carry its own copy of the same literal-with-a-refusal-message, six in all. They
now share this one, so the rule that a reader never downgrades, and the message it refuses with, live in one place.
