---
---

test(e2e): check the wallet goes on syncing after the v9 fork, and resumes from a snapshot taken after it

Test-only. Two cases at the end of the fork lane, after the ledger-v9 spends:

- A wallet restored from a snapshot taken after the crossing must sync on the V2 variants and hold a balance that
  includes a transfer made after the snapshot, so it cannot pass by merely deserializing.
- After two idle minutes the wallet must still be synced, still settled on ledger-v9 with no further crossing, and must
  see a transaction submitted after the wait.
- The lane's protocol-version checks are exact, against the version the node reports: a probe-started wallet on
  ledger-v8, the recipes it builds, and a restored wallet from its first state onwards must each report the chain's
  version, where the old range checks also passed a wallet stuck at its variant's lower bound.
