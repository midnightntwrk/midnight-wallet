# npmjs Trusted Publishing and scope rename to `@midnightntwrk`

- Status: accepted
- Deciders: Agron Murtezi, SRE team
- Date: 2026-06-18 (updated 2026-06-22)

Technical Story: migrate CD off GitHub Packages and onto the `@midnightntwrk` npm org.

## Context and Problem Statement

The Wallet SDK historically published under the `@midnight-ntwrk` scope to GitHub Packages, authenticated with a
long-lived PAT. Two things needed to change at once:

- **Registry & auth:** move to npmjs with [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) so
  publishes are tokenless and carry provenance attestations, gated behind environments with human review for stable
  releases.
- **Scope:** the new npm org is `midnightntwrk` (no dash), so packages publish under `@midnightntwrk/*` rather than
  `@midnight-ntwrk/*`.

A hard cut-over would break every existing consumer of `@midnight-ntwrk/*`, so the dashed scope is kept alive as a
transitional alias during the migration window.

## Decision

Dual-publish both scopes from npmjs, with `@midnightntwrk` canonical in source and `@midnight-ntwrk` generated at
publish time. Both scopes publish via OIDC + provenance — there are no long-lived publish tokens.

### Scopes

- **Source tree uses `@midnightntwrk`.** Package names, internal SDK dependency ranges, source imports, changesets, and
  the lockfile are all on the dashless scope.
- **`@midnight-ntwrk` is a publish-time alias.** `scripts/publish-alias.mjs` stages a copy of each package in a temp dir
  and rewrites the name, internal SDK deps, and compiled `dist/**` import specifiers back to the dashed scope, then
  publishes it. The working tree stays pristine (so `changeset tag` tags the canonical scope). The alias README carries
  a migration banner pointing at the `@midnightntwrk` equivalent.
- **Both scopes publish via OIDC + `npm publish --provenance`** — no token in the environment, so npm performs the
  Trusted Publishing token exchange. Each package, **under both scopes**, needs a Trusted Publisher configured on npmjs:
  - repo: `<owner>/<this-repo>`
  - workflow: `.github/workflows/cd.yml`
  - environment: `npm-publish-stable` or `npm-publish-canary`
- **Upstream dashed dependencies** (`ledger-v8`, `zkir-v2`) are not ours and remain on GitHub Packages — install-time
  auth uses a read PAT; they stay dashed everywhere.

### CD topology and publishing scenarios

`.github/workflows/cd.yml` runs three jobs on every push to `main`/`v2`:

- **`version`** (ungated) — runs `changesets/action` to create/update the "Version Packages" PR, then resolves a single
  `mode` output the publish jobs gate on. `mode` is derived from two internal signals: `hasChangesets` (any changeset
  files present, from the action) and `hasReleases` (any pending changeset actually bumps a package, via
  `changeset status --output`). It is `stable` when no changesets remain, `canary` when a package-bumping changeset is
  pending, and `none` otherwise.
- **`publish-stable`** (gated by the `npm-publish-stable` environment, with required reviewers) — `needs: [version]`,
  runs when `mode == 'stable'`. Publishes canonical versions of both scopes and pushes git tags.
- **`canary`** (environment `npm-publish-canary`, no required reviewers) — `needs: [version]`, runs when
  `mode == 'canary'`. Publishes a snapshot of both scopes under the `canary` dist-tag.

A single `mode` output drives both publish jobs, so a push triggers **exactly one** publishing scenario, or neither
(`mode == 'stable'` wins whenever no changesets remain, which also implies `hasReleases` is `false`, so the two can
never collide):

| Push                           | `hasChangesets` | `hasReleases` | `mode`   | Result                       |
| ------------------------------ | --------------- | ------------- | -------- | ---------------------------- |
| "Version Packages" PR merged   | `false`         | `false`       | `stable` | `publish-stable` → canonical |
| Pending package-bumping change | `true`          | `true`        | `canary` | `canary` → snapshot          |
| Docs/CI-only (empty changeset) | `true`          | `false`       | `none`   | neither                      |

### Canary publishes all packages as one coherent set

`changeset version --snapshot` only versions packages named in a changeset (plus their dependents), which would leave
the `canary` dist-tag inconsistent across packages. Before snapshotting, the canary job runs
`scripts/write-canary-changeset.mjs`, which writes a temporary changeset patch-bumping **every** publishable package, so
the whole SDK at `@canary` is a coherent set from a single commit. Real pending changesets are kept, so their
minor/major bumps still win. As defence-in-depth, `scripts/publish-alias.mjs` skips any package whose version lacks a
snapshot prerelease (`-`) when publishing under a `--tag`, so a canonical version can never reach a `canary*` tag.

## Consequences

- Existing `@midnight-ntwrk` consumers keep resolving throughout the migration.
- Both scopes are tokenless and provenance-attested; there is no long-lived publish token to rotate or leak.
- Identical content under both scopes is guaranteed by a single build per run.
- Stable releases require human approval (the `npm-publish-stable` environment); canary never blocks on approval.
- The scope rename was a large mechanical diff, and `publish-alias.mjs` carries temp-dir staging + dist-specifier
  rewriting for the duration of the migration window.

The alias is removed (the alias branch in `scripts/publish-alias.mjs` + the migration banner) once consumers have
migrated to `@midnightntwrk`.

## Links

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers)
- Implemented by `scripts/publish-alias.mjs`, `scripts/write-canary-changeset.mjs`, and `.github/workflows/cd.yml`

## Amendment (2026-06-30): canonical publish handed back to `changeset publish`

The original decision had a single hand-rolled script (`scripts/publish.mjs`) publish **both** scopes via
`npm publish --provenance`. That worked, but it published the canonical scope outside `changesets/action`, and the
action's publish step is what creates **GitHub Releases** (one per package, body from each `CHANGELOG.md`, parsed from
the `New tag:` lines its publish command prints). Hand-rolling the publish therefore silently dropped GitHub Releases —
they stopped being created once publishing moved into a bare workflow step.

Rather than re-implement release creation ourselves, the canonical `@midnightntwrk` publish was handed back to
`changeset publish`, which restores Releases for free and reduces the script to its actual reason for existing (the
alias). The topology described above is updated as follows; everything else (dual-scope intent, OIDC + provenance,
per-type environments with stable-only human approval, the canary coherent-set via `write-canary-changeset.mjs`) is
unchanged.

- **Canonical `@midnightntwrk` is published by `changeset publish`, everywhere.**
  - `publish-stable`: `changesets/action` runs `changeset publish`. The action publishes the canonical scope (OIDC;
    provenance via `NPM_CONFIG_PROVENANCE=true`), pushes the release tags, and **creates a GitHub Release per package**.
    This replaces the old bare `yarn changeset:publish` + manual `git push --tags` step (and the `changeset:publish` npm
    script, now removed).
  - `canary`: `changeset publish --tag <canary-tag> --no-git-tag` publishes the snapshot. `--no-git-tag` keeps canaries
    tag-less and Release-less (only the action creates Releases, not the CLI). This also exercises the
    `changeset publish` + OIDC path on every snapshot push, so the stable path's publishing is continuously validated.
- **`scripts/publish-alias.mjs` is now single-purpose** — it only stages and mirrors the dashed `@midnight-ntwrk` alias,
  running **after** the canonical publish in both jobs (so the alias can never lead the canonical scope). It no longer
  publishes the canonical scope; the `--alias-only` flag and the `publishPrimary` path were removed.
- **GitHub Releases are an explicit, restored behavior** of `publish-stable`, created by `changesets/action`.

Net effect on the topology table: `publish-stable` → canonical via `changeset publish` (+ tags + GitHub Releases) then
alias; `canary` → canonical snapshot via `changeset publish --no-git-tag` then alias.
