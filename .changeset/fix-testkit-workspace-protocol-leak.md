---
'@midnightntwrk/wallet-sdk-testkit': patch
---

Fix uninstallable `wallet-sdk-testkit@0.2.0`. That release shipped its internal
`wallet-sdk-*` dependencies (and the `wallet-sdk-utilities` peer) as the
monorepo-only `workspace:^` specifier, which leaked into the published tarball on
both the `@midnightntwrk` and `@midnight-ntwrk` scopes. External installs failed
(`npm` → `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`, `yarn` classic
→ "Couldn't find any versions ... that matches workspace:^"). This release
publishes those dependencies with concrete versions, restoring installability.
