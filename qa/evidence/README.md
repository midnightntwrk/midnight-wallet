# QA Release Test Evidence

Human-readable test evidence captured for each Wallet SDK release.

## Layout

```
qa/evidence/
  README.md                       ← this file
  wallet-sdk-<version>/README.md  ← evidence for @midnightntwrk/wallet-sdk@<version>
```

Each `wallet-sdk-<version>/README.md` contains:

- **Release Metadata** — date, QA contact, wallet-sdk / ledger / node versions, networks, and a **QA Sign-off** field.
- **Test Execution Summary** — `Environment | Suite | Passed | Failed | Skipped | Total`, one row per run.
- **Results by File** and **Detail** — per-file and per-test outcomes with durations.
- **Test Execution Guide** — commands to reproduce the run.

## How it works (semi-automated)

1. **Dispatch** the [`QA Release Evidence`](../../.github/workflows/qa-evidence.yml) workflow
   (`Actions → QA Release Evidence → Run workflow`) while the release is still pending. By default it runs **all
   undeployed tests** plus the **remote `@smoke` subset**; the `run_*` toggles and `*_modifier` inputs let you instead
   capture evidence for an individual test on either environment.
2. The workflow derives the **upcoming** release version from the pending changesets (so the evidence is keyed to the
   version about to ship, not the one currently on `main`), runs the suites, renders the evidence README, and uploads
   the raw HTML / Allure / JUnit / JSON reports as a run artifact.
3. It opens a **sign-off PR** adding `wallet-sdk-<version>/README.md`.
4. **QA reviews** the results, sets **QA Sign-off** to ✅ (and fills **QA Contact** if blank), and **merges to `main`**
   — that merge is the human sign-off.
5. When the release is published, [`cd.yml`](../../.github/workflows/cd.yml) finds the committed evidence for the
   released version and appends its summary + a link into the `@midnightntwrk/wallet-sdk` GitHub Release notes.

## Regenerating locally

```shell
# Produce vitest JSON reports, then render the evidence from them:
yarn workspace @midnight/wallet-e2e-tests generate-evidence \
  undeployed:e2e:packages/e2e-tests/reports/undeployed.json \
  remote:smoke:packages/e2e-tests/reports/remote-smoke.json \
  --version <version> --networks "undeployed, preview"
```

Run specs are `<environment>:<suite-label>:<vitest-json-path>` — pass as many as you have runs.
