---
'@midnightntwrk/wallet-sdk-testkit': patch
---

fix(testkit): point the network presets at their shielded.tools hosts

The `devnet`, `qanet` and `preview` presets use `*.<network>.shielded.tools`, and qanet's websocket endpoint moves from
`indexer-blue` to `indexer`, the same host as its HTTP endpoint. The `preprod` preset's indexer moves to
`indexer.preprod.shielded.tools`, replacing the decommissioned `indexer.preprod.midnight.network`; its node stays on
`rpc.preprod.midnight.network`.
