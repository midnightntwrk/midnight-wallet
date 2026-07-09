---
---

ci: add a one-off `Fix @midnight-ntwrk dist-tags` workflow + `scripts/fix-alias-dist-tags.mjs`
to move stale `latest` tags on the transitional dashed alias scope to the highest published
stable version. Tooling only — no package changes.
