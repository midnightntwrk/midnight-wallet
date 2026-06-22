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
- **`@midnight-ntwrk` is a publish-time alias.** `scripts/publish.mjs` stages a copy of each package in a temp dir and
  rewrites the name, internal SDK deps, and compiled `dist/**` import specifiers back to the dashed scope, then
  publishes it. The working tree stays pristine (so `changeset tag` tags the canonical scope). The alias README carries
  a migration banner pointing at the `@midnightntwrk` equivalent.
- **Both scopes publish via OIDC + `npm publish --provenance`** — no token in the environment, so npm performs the
  Trusted Publishing token exchange. Each package, **under both scopes**, needs a Trusted Publisher configured on npmjs:
  - repo: `<owner>/<this-repo>`
  - workflow: `.github/workflows/cd.yml`
  - environment: `npm-publish-stable` or `npm-publish-canary`
- **Upstream dashed dependencies** (`ledger-v8`, `wallet-api`, `zkir-v2`, `midnight-js-network-id`) are not ours and
  remain on GitHub Packages — install-time auth uses a read PAT; they stay dashed everywhere.

### CD topology and publishing scenarios

`.github/workflows/cd.yml` runs three jobs on every push to `main`/`v2`:

- **`version`** (ungated) — runs `changesets/action` to create/update the "Version Packages" PR. Exposes two outputs the
  publish jobs gate on: `hasChangesets` (any changeset files present) and `hasReleases` (any pending changeset actually
  bumps a package, via `changeset status --output`).
- **`publish-stable`** (gated by the `npm-publish-stable` environment, with required reviewers) — `needs: [version]`,
  runs when `hasChangesets == 'false'`. Publishes canonical versions of both scopes and pushes git tags.
- **`canary`** (environment `npm-publish-canary`, no required reviewers) — `needs: [version]`, runs when
  `hasReleases == 'true'`. Publishes a snapshot of both scopes under the `canary` dist-tag.

The two `if` conditions are mutually exclusive, so a push triggers **exactly one** publishing scenario, or neither:

| Push                           | `hasChangesets` | `hasReleases` | Result                       |
| ------------------------------ | --------------- | ------------- | ---------------------------- |
| "Version Packages" PR merged   | `false`         | `false`       | `publish-stable` → canonical |
| Pending package-bumping change | `true`          | `true`        | `canary` → snapshot          |
| Docs/CI-only (empty changeset) | `true`          | `false`       | neither                      |

### Canary publishes all packages as one coherent set

`changeset version --snapshot` only versions packages named in a changeset (plus their dependents), which would leave
the `canary` dist-tag inconsistent across packages. Before snapshotting, the canary job runs
`scripts/write-canary-changeset.mjs`, which writes a temporary changeset patch-bumping **every** publishable package, so
the whole SDK at `@canary` is a coherent set from a single commit. Real pending changesets are kept, so their
minor/major bumps still win. As defence-in-depth, `scripts/publish.mjs` skips any package whose version lacks a snapshot
prerelease (`-`) when publishing under a `--tag`, so a canonical version can never reach a `canary*` tag.

## Consequences

- Existing `@midnight-ntwrk` consumers keep resolving throughout the migration.
- Both scopes are tokenless and provenance-attested; there is no long-lived publish token to rotate or leak.
- Identical content under both scopes is guaranteed by a single build per run.
- Stable releases require human approval (the `npm-publish-stable` environment); canary never blocks on approval.
- The scope rename was a large mechanical diff, and `publish.mjs` carries temp-dir staging + dist-specifier rewriting
  for the duration of the migration window.

The alias is removed (the alias branch in `scripts/publish.mjs` + the migration banner) once consumers have migrated to
`@midnightntwrk`.

## Links

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers)
- Implemented by `scripts/publish.mjs`, `scripts/write-canary-changeset.mjs`, and `.github/workflows/cd.yml`
