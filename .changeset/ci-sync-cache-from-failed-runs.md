---
---

ci: publish the healthcheck sync cache from failed runs too, and restore the newest unexpired one whatever the run's
conclusion, so a lane that has been red longer than the artifact retention period no longer syncs every wallet from
scratch forever; remove the qanet healthcheck, whose hosts resolve to private addresses that GitHub-hosted runners
cannot reach
