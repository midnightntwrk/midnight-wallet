---
'@midnightntwrk/wallet-sdk-testkit': patch
---

fix(testkit): point the network presets at their shielded.tools hosts

The `devnet` and `qanet` presets use `*.<network>.shielded.tools`. These hosts resolve to private addresses, so
reaching them needs the VPN. The `preprod` preset moves to `indexer.preprod.shielded.tools`, replacing the
decommissioned `indexer.preprod.midnight.network`, and to `rpc.preprod.shielded.tools` for its node. The `preview`
preset is unchanged. Any preset host can be replaced through `createRemoteEnvironment`'s `endpoints` option.
