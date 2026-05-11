---
'@midnight-ntwrk/wallet-sdk': minor
---

Barrel-export every non-ignored wallet-sdk package. Adds `indexer-client`, `node-client`, `prover-client`, `runtime`, and `utilities` as new subpath entry points (each matching their package folder name), and surfaces every nested subpath those packages already expose (`/v1`, `/effect`, `/abstractions`, `/balancer`, `/pendingTransactions`, `/proving`, `/simulation`, `/submission`, `/networking`, `/types`, `/testing`). The main entry point now also re-exports `prover-client` and `utilities` flat, plus namespaced `Capabilities`, `IndexerClient`, `NodeClient`, and `Runtime` (namespaced to avoid name collisions with other packages). Legacy `/proving` and `/testing` aliases remain for backwards compatibility.
