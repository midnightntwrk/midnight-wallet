---
name: changeset
description: >
  Create a changeset for the Midnight Wallet SDK monorepo. Use whenever a change to packages/** is ready for
  review/commit and no changeset exists yet, when `yarn changeset:check` (or its CI job) fails, or when the user asks
  for a changeset. `yarn changeset add` is an interactive CLI an agent cannot drive — write the changeset file directly
  instead.
---

# Create a changeset (non-interactively)

Changesets record what should be released. The interactive `yarn changeset add` doesn't work for agents — write the file
directly. The file format is trivial; the judgment is in the bump type and package selection.

## 1. Does this change need a changeset at all?

- Docs, tooling, CI, tests only → **empty changeset** (explicit "no release needed"):

  ```bash
  yarn changeset add --empty
  ```

  (This one IS non-interactive — it just writes an empty file.)

- Changes to published `packages/**` code → real changeset, continue below.

## 2. Pick the packages

- List only the **directly changed, published** packages — Changesets pulls in dependent internal packages
  automatically. Do not list dependents.
- Never list ignored/private packages — the `ignore` array in `.changeset/config.json` is the source of truth; check it.
- Package names are the `name` field of each `packages/*/package.json` (e.g.
  `@midnightntwrk/wallet-sdk-shielded-wallet`).

## 3. Pick the bump (SemVer)

| Bump    | When                                                                                         |
| ------- | -------------------------------------------------------------------------------------------- |
| `major` | Breaking change to a public API (removed/renamed export, changed behavior consumers rely on) |
| `minor` | New backwards-compatible feature                                                             |
| `patch` | Bug fix or internal improvement with no API change                                           |

If unsure between two bumps, ask the user — the bump is a release decision.

## 4. Write the file

Create `.changeset/<kebab-case-slug>.md` (any unique slug; describe the change, e.g. `fix-utxo-selection-overflow.md`):

```markdown
---
'@midnightntwrk/wallet-sdk-<package>': patch
---

<type>(<scope>): short imperative summary

Optional body: what changed and why, as it should read in the CHANGELOG. For breaking changes add a `BREAKING CHANGE:`
paragraph describing the migration.
```

Multiple packages → one line each in the frontmatter (they can have different bumps).

## 5. Verify

```bash
yarn changeset:check
```

Must pass (no "packages changed but no changesets found" error). The file is committed with the change — versions and
changelogs are applied later by the automated release PR, never by hand.
