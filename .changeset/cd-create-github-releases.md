---
---

chore(ci): publish the canonical @midnightntwrk scope with `changeset publish`
everywhere — changesets/action for stable releases (which also pushes tags and
creates a GitHub Release per package, restoring the Releases dropped when
publishing was hand-rolled), and a `--no-git-tag` snapshot publish for canaries.
scripts/publish.mjs is now single-purpose (and renamed scripts/publish-alias.mjs):
it only mirrors the transitional @midnight-ntwrk (dashed) alias.
