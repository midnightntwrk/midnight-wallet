---
'@midnight-ntwrk/wallet-sdk-runtime': patch
---

Replace the shared unbounded-with-replay runtime state-changes stream with per-subscriber
`SubscriptionRef.changes` decoupled by a sliding buffer of capacity 1. The previous configuration
kept references to past state instances alive, preventing them from being released: Effect's PubSub
replay buffer appends every published value to a shared linked list and a subscription's replay
window never releases its head node, so any long-lived subscriber pinned every state published
during its lifetime (and the wasm resources those states hold).

The stream now has latest-value semantics: every subscriber receives the current state on
subscription and always converges on the latest state, but may skip intermediate states when it
lags behind the producer. Memory is bounded to the current state plus at most one buffered state
per subscriber.
