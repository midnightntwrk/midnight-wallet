---
'@midnightntwrk/wallet-sdk-testkit': patch
---

The dust and token-transfer healthcheck scenarios now allow 45 minutes to sync by default instead of 15, so a wallet
built from scratch on a long-lived network such as preprod can finish. CI publishes the healthcheck sync cache from
failed runs too and restores the newest unexpired one whatever the run's conclusion, so a lane that has been red longer
than the artifact retention period no longer syncs every wallet from scratch forever. The qanet healthcheck is removed:
its hosts resolve to private addresses that GitHub-hosted runners cannot reach.
