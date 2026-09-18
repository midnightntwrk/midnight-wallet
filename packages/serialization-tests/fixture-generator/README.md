# Fixture generator

Writes the frozen fixtures under `../fixtures/<surface>/<version>/` by running the **real published SDK releases**. Each
release is installed under an npm alias (`un-3.1.0` → `@midnightntwrk/wallet-sdk-unshielded-wallet@3.1.0`) with its
ledger pinned to the exact version that release shipped against, then driven with fixed seeds, coin values and block
times to produce a wallet and serialize it. Every payload is self-checked — the release that wrote it must read it back
— or generation fails.

This is a **standalone npm project, deliberately not a yarn workspace member**: it needs many versions of the same
packages side by side, which a workspace cannot express. Its `package-lock.json` is committed so a rerun installs the
same dependency tree.

## When to run it

Rarely, and never in CI. The fixtures are a record of what shipped; they change only when:

- a **new release train** is published and needs a fixture folder (`.claude/rules/persisted-formats.md`), or
- an existing fixture turns out to be **unrepresentative** of what a real wallet writes, as the unshielded ones once
  were: they carried a placeholder key and address that no wallet could have produced, which a reader that checks the
  address against the key refuses.

Never run it to make a failing compatibility test pass. If a frozen fixture fails to restore, the code is wrong, not the
record — the CI frozen-file check exists precisely so the record cannot be quietly rewritten.

## How to run it

```bash
cd packages/serialization-tests/fixture-generator
npm ci
ONLY=unshielded node generate.mjs        # one surface; omit ONLY for all five
```

`ONLY` takes a comma-separated subset of `shielded,unshielded,dust,tx-history,pending-transactions`. Regenerate only the
surface you have a reason to touch — every other fixture is a frozen record and must stay byte-identical.

Output lands in `../fixtures/<train>/<name>.json` (the generator's own layout). Move each file into the versioned layout
the tests read, then let prettier settle the formatting:

```bash
mv ../fixtures/facade-4.1.0/unshielded.json          ../fixtures/unshielded/v1/facade-4.1.0.json
mv ../fixtures/facade-4.1.0/unshielded-minimal.json  ../fixtures/unshielded/v1/facade-4.1.0-minimal.json
rmdir ../fixtures/facade-4.1.0
yarn prettier --write "../fixtures/unshielded/v1/*.json"
```

Then recapture the drift baselines for that surface and confirm nothing else moved:

```bash
yarn capture                                      # from packages/serialization-tests
git diff --stat -- fixtures/_baseline/            # only the regenerated surface's baselines should appear
```

## Adding a train

`npm view @midnightntwrk/wallet-sdk-facade@<version> dependencies` gives the package versions the train shipped; add an
alias per package to `package.json` (and a ledger `override` if the train pins one), add a row to `TRAINS` in
`generate.mjs`, run `npm install` to refresh the lockfile, then generate.

## Files

| File              | Role                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `generate.mjs`    | Per-surface generators, the `TRAINS` table, the `ONLY` filter, self-checks.             |
| `chainDriver.mjs` | Event replay through a train's own ledger, so snapshots hold what a synced wallet held. |
| `probe.mjs`       | Dev helper that dumps each train's API surface. Not needed once fixtures exist.         |

This generator is what ADR 0008 (`docs/decisions/0008-persisted-format-versioning.md`) means by "captured from a
published release"; the frozen corpus under `../fixtures/` is its output.
