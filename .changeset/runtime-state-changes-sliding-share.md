---
'@midnight-ntwrk/wallet-sdk-runtime': patch
---

Use a sliding buffer of capacity 1 for the shared runtime state-changes stream instead of an
unbounded buffer with replay. The previous configuration kept references to past state instances
alive, preventing them from being released. Retaining only the latest state allows the underlying
wasm to free local state instances that are no longer needed.
