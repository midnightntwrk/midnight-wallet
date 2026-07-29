---
---

chore(utilities): reconcile the in-repo version to 1.2.1.

`@midnightntwrk/wallet-sdk-utilities@1.2.1` (and the `@midnight-ntwrk` alias) was
published out-of-band from a hotfix off the v1.2.0 tag, to restore the `Clock`
export that the dashed-scope 1.2.0 tarball shipped without. This bumps the
in-repo version to match the registry so the release base is correct and any
future change bumps from 1.2.1. Empty changeset on purpose: the change is
already released, so this must not trigger another version bump or publish.
