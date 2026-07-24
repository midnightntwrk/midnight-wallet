---
---

chore(qa): add semi-automated release test-evidence generation. A new
`QA Release Evidence` workflow runs the release suites (all undeployed +
remote `@smoke` by default; individual tests selectable via modifier inputs),
renders a human-readable evidence README under `qa/evidence/wallet-sdk-<version>/`
keyed to the upcoming release version, and opens a QA sign-off PR. On publish,
`cd.yml` surfaces the committed evidence in the `@midnightntwrk/wallet-sdk`
GitHub Release notes.
