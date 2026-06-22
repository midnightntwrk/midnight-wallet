# npmjs Trusted Publishing and scope rename to `@midnightntwrk`

- Status: accepted
- Deciders: Agron Murtezi, SRE team
- Date: 2026-06-18

Technical Story: migrate CD off GitHub Packages and onto the `@midnightntwrk` npm org.

> **Update (2026-06-22):** Trusted Publishing was subsequently configured on npmjs for the dashed `@midnight-ntwrk`
> scope too, so the transitional alias now publishes via **OIDC + `--provenance`** as well — the token-based alias auth
> (`NPM_LEGACY_TOKEN`) and the one-time bootstrap job have been removed, and both scopes now publish identically and
> tokenlessly. The "Auth differs per scope" specifics and the related negative consequences below are kept for history
> but no longer reflect the implementation. CD topology is now three jobs — `version` (ungated, manages the release PR),
> `publish-stable` (gated, runs when the release PR merges), and `canary` (snapshot). Canary publishes only when there
> are pending package-bumping changesets and snapshots **all** publishable packages as one coherent set from the commit.

## Context and Problem Statement

The Wallet SDK has historically published under the `@midnight-ntwrk` scope to GitHub Packages, authenticated with a
long-lived PAT. Two things need to change at once:

- **Registry & auth:** move to npmjs with [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) so
  publishes are tokenless and carry provenance attestations, gated behind environments with human review for stable
  releases.
- **Scope:** the new npm org is `midnightntwrk` (no dash), so packages must publish under `@midnightntwrk/*` rather than
  `@midnight-ntwrk/*`.

A hard cut-over would break every existing consumer that depends on `@midnight-ntwrk/*`. How do we change registry,
auth, and scope without breaking downstream consumers, and without standing up throwaway infrastructure for a temporary
state?

## Decision Drivers

- Do not break existing consumers of `@midnight-ntwrk/*` during the migration window.
- Prefer tokenless, attestable publishing (OIDC + provenance) for the canonical packages.
- Keep the build graph and developer workflow stable — a scope rename must not destabilise local dev or CI.
- Avoid building the monorepo twice or shipping non-identical bytes under the two scopes.
- Keep the transitional machinery cheap to remove, since it is temporary by design.
- Upstream `@midnight-ntwrk/*` dependencies (`ledger-v8`, `wallet-api`, `zkir-v2`, `midnight-js-network-id`) are not
  ours and continue to live on GitHub Packages — they must remain dashed everywhere.

## Considered Options

1. **Hard cut-over** to `@midnightntwrk` only.
2. **Dual-publish** both scopes during a migration window, with `@midnightntwrk` as the canonical scope in source and
   `@midnight-ntwrk` generated as a transitional alias.
3. **Dual-publish with the alias as the source scope** — keep `@midnight-ntwrk` in source and generate `@midnightntwrk`
   at publish time.

For the dual-publish mechanics, two sub-questions:

- **Where the alias rename lives:** publish-time-only (leave source on `@midnight-ntwrk`) vs. rename the source tree to
  `@midnightntwrk` and rewrite back to dashed at publish time.
- **Job topology:** one job publishing both scopes vs. a separate job per scope.

## Decision Outcome

Chosen: **option 2 — dual-publish with `@midnightntwrk` canonical in source**, with these specifics:

- **Source tree uses `@midnightntwrk`.** The rename touches package names, internal SDK dependency ranges, ~172 source
  import references, changesets, and the lockfile. Upstream dashed deps are left untouched.
- **The `@midnight-ntwrk` alias is generated at publish time.** `scripts/publish.mjs` stages a copy of each package in a
  temp dir and rewrites the name, internal SDK deps, and compiled `dist/**` import specifiers back to the dashed scope.
  The working tree stays pristine (so `changeset tag` tags the canonical scope).
- **Auth differs per scope.** Primary `@midnightntwrk` publishes via OIDC with `npm publish --provenance` (no token).
  The alias publishes with the legacy `MIDNIGHTCI_PACKAGES_WRITE` token (surfaced as `NPM_LEGACY_TOKEN`), without
  provenance — token publishes cannot emit OIDC attestations. The script blanks `NODE_AUTH_TOKEN` for the primary
  publish so npm falls back to OIDC.
- **One job per release type publishes both scopes.** The two CD jobs (`release` stable + gated, `canary` snapshot) each
  invoke the single dual-publishing script. Both scopes ship from the same checkout and the same built `dist/`.
- **The alias README carries a migration banner** pointing consumers at the `@midnightntwrk` equivalent.

The alias is removed (script branch + `NPM_LEGACY_TOKEN` + token rotation) once consumers have migrated.

### Positive Consequences

- Existing `@midnight-ntwrk` consumers keep resolving throughout the migration.
- Canonical `@midnightntwrk` packages are tokenless and provenance-attested.
- Identical content under both scopes is guaranteed by a single build per run.
- The transitional code is isolated to `publish.mjs` and a single workflow env var, so teardown is a small, reviewable
  change.

### Negative Consequences

- The scope rename is a large mechanical diff.
- `publish.mjs` carries non-trivial logic (temp-dir staging, dist-specifier rewriting) for the duration of the window.
- The alias publish has no provenance.
- The job that runs OIDC also has the legacy token present in its environment (mitigated: the token is never _used_ for
  the primary publish — `NODE_AUTH_TOKEN` is blanked there).

## Pros and Cons of the Options

### Hard cut-over

- Good, because simplest possible publish flow.
- Bad, because it immediately breaks every `@midnight-ntwrk` consumer — unacceptable.

### Dual-publish, `@midnightntwrk` canonical in source (chosen)

- Good, because the canonical scope is the one that gets OIDC + provenance and the one developers see everywhere.
- Good, because the dashed alias is purely a publish-time artifact, easy to delete later.
- Bad, because it requires a large source rename and dist-specifier rewriting for the alias.

### Dual-publish, `@midnight-ntwrk` canonical in source

- Good, because no source rename — smallest diff.
- Bad, because the canonical scope going forward (`@midnightntwrk`) would be the _rewritten_ one, so provenance/source
  identity would lag the scope we actually want to be primary.

### Job topology: one job vs. separate jobs

One job per release type was chosen.

- Good (one job), because the monorepo builds once and both scopes ship identical bytes; the canary job's snapshot
  versioning is computed a single time.
- Good (one job), because idempotent skip-on-already-published makes whole-run retries safe.
- Bad (one job), because the OIDC job also has the legacy token in its environment.
- Separate jobs would isolate the token but require building twice or passing build artifacts between jobs, and would
  duplicate the canary snapshot setup — not worth it for a temporary alias.

## Links

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers)
- Implemented by `scripts/publish.mjs` and `.github/workflows/cd.yml`
