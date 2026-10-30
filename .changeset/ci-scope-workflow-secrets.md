---
---

ci: give each workflow step only the secrets and token scopes it uses

CI only, nothing to release. Secrets move from workflow-level `env:` into the steps that read them, reusable workflows
take explicit secrets instead of `secrets: inherit`, the e2e jobs replace `write-all` with the scopes the test reporter
needs and use the read-only packages token, and the unused `fund_test_wallets.yml` workflow is removed.
