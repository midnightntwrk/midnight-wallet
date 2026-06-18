# npm Publish Rollout

One-time playbook for moving CD from GitHub Packages → npmjs with Trusted Publishing + provenance + environment gating,
**and** renaming the npm scope `@midnight-ntwrk` → `@midnightntwrk`. During the migration window CD **dual-publishes**
every package under both scopes so existing consumers are not broken. Delete or convert to a steady-state doc once the
transition items below are checked off.

## Scope model

| Scope               | Role               | Registry | Auth                                         | Provenance |
| ------------------- | ------------------ | -------- | -------------------------------------------- | ---------- |
| `@midnightntwrk/*`  | primary (new)      | npmjs    | Trusted Publishing (OIDC), no token          | yes        |
| `@midnight-ntwrk/*` | transitional alias | npmjs    | legacy `MIDNIGHTCI_PACKAGES_WRITE` npm token | no         |

The source tree uses the **new** `@midnightntwrk` scope. `scripts/publish.mjs` stages a dashed-scope copy of each
package (rewriting the name, internal SDK deps, and compiled `dist/**` import specifiers back to `@midnight-ntwrk`) and
publishes it with the legacy token. Upstream deps (`@midnight-ntwrk/ledger-v8`, `wallet-api`, `zkir-v2`,
`midnight-js-network-id`) keep the dashed scope everywhere — they are not ours and still install from GH Packages.

## What changed in the codebase

| File                               | Change                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All source / `package.json` / docs | `@midnight-ntwrk/wallet-sdk*` → `@midnightntwrk/wallet-sdk*` (17 packages + 172 source refs). Upstream `@midnight-ntwrk/*` deps untouched.                                                              |
| `.changeset/config.json`           | `access: restricted` → `public`                                                                                                                                                                         |
| `.yarnrc.yml`                      | Dropped `npmPublishRegistry`; install registry for the upstream `@midnight-ntwrk` scope still GH Packages                                                                                               |
| `packages/*/package.json`          | `publishConfig.registry` → `https://registry.npmjs.org/`, added `"access": "public"`                                                                                                                    |
| `package.json` (root)              | `changeset:publish` → `yarn dist:publish && node scripts/publish.mjs && yarn changeset tag`                                                                                                             |
| `scripts/publish.mjs`              | Dual-publish: primary `@midnightntwrk` via `npm publish --provenance` (OIDC); alias `@midnight-ntwrk` from a rewritten temp copy via the legacy token. Idempotent per scope via registry version check. |
| `.github/workflows/cd.yml`         | `id-token: write` on both jobs; environments `npm-publish-stable` / `npm-publish-canary`; `npm install -g npm@latest` (Trusted Publishing needs npm 11.5.1+); `NPM_LEGACY_TOKEN` for the alias publish. |

## Rollout checklist

### 1. Pre-flight

- [ ] `@midnightntwrk` org exists / is claimed on npmjs.com (the **new** scope)
- [ ] `MIDNIGHTCI_PACKAGES_WRITE` token can **publish to npmjs** under the `@midnight-ntwrk` scope (it is used for the
      alias publish) **and** still **read GH Packages** for upstream installs
- [ ] Decide who can approve stable releases (reviewers on the `npm-publish-stable` environment)
- [ ] Confirm `main` branch protection requires PR review

### 2. npmjs side — Trusted Publishers for the primary scope (one-time per package)

The dashed alias uses a token and needs **no** trusted publisher. Configure publishers only for the new
`@midnightntwrk/*` packages. For each of the 14 publishable packages (list at bottom), add **two** pending Trusted
Publishers via npmjs.com → package or org settings:

- Provider: GitHub Actions
- Owner/Repo: `<owner>/<this-repo>`
- Workflow filename: `cd.yml`
- Environment: `npm-publish-stable` _(entry 1)_ and `npm-publish-canary` _(entry 2)_

Use the **"pending publisher"** option so it works for first-publish of each package. Pending publishers expire
(currently ~30 days on npm), so configure close to first publish attempt.

Docs: https://docs.npmjs.com/trusted-publishers

- [ ] All 14 `@midnightntwrk/*` packages configured with both environments

### 3. GitHub side — one-time

Settings → Environments:

- [ ] Create `npm-publish-stable` with required reviewer(s); optionally restrict to `main` via deployment branch rules
- [ ] Create `npm-publish-canary` (empty — just needs to exist so the trusted-publisher match works)

### 4. Canary smoke test (lower stakes)

- [ ] Merge changes to `main`
- [ ] Watch the `canary` job in the CD workflow run
- [ ] Verify each package publishes under **both** scopes (`@midnightntwrk/*` with provenance, `@midnight-ntwrk/*`
      without)
- [ ] If OIDC fails, the error log shows the `workflow_ref` value npm received — match the trusted-publisher config to
      that string exactly

### 5. Verify

After a successful canary:

```
npm view @midnightntwrk/wallet-sdk@<canary-version>     # primary
npm view @midnight-ntwrk/wallet-sdk@<canary-version>    # alias
```

- [ ] Both scopes show the canary version
- [ ] `attestations` field present on the `@midnightntwrk` metadata
- [ ] `npm audit signatures` passes in a fresh consumer project depending on `@midnightntwrk/*`

### 6. First stable release

- [ ] Open release PR via changesets, merge it
- [ ] CD `release` job blocks on `npm-publish-stable` environment
- [ ] Reviewer approves → job publishes 14 packages under both scopes + creates git tags
- [ ] Confirm packages visible on npmjs under both scopes

### 7. End the transition

- [ ] Announce the `@midnightntwrk` scope to consumers; give them time to migrate
- [ ] Once consumers are off `@midnight-ntwrk`: remove the alias publish from `scripts/publish.mjs`, drop
      `NPM_LEGACY_TOKEN` from `cd.yml`, and rotate/narrow `MIDNIGHTCI_PACKAGES_WRITE` to `read:packages` only
- [ ] Convert this doc to steady-state publishing docs or delete

## Failure modes & fixes

| Symptom                                              | Cause                                                                                                       | Fix                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm error 404 ... no such package` on first publish | Package doesn't exist yet and no pending publisher configured (primary scope)                               | Set up pending publisher on npmjs                             |
| `npm error 403 OIDC token exchange failed`           | Trusted publisher config doesn't match the actual `workflow_ref` (wrong repo / workflow path / environment) | Match config exactly to the `workflow_ref` value in the error |
| Alias `@midnight-ntwrk` publish 401/403              | `MIDNIGHTCI_PACKAGES_WRITE` cannot publish that scope to npmjs                                              | Grant the token npmjs publish rights for `@midnight-ntwrk`    |
| Alias publish skipped entirely                       | `NPM_LEGACY_TOKEN` not set on the publish step                                                              | Confirm the env var is wired in `cd.yml`                      |
| `npm publish` reports unsupported npm version        | The `npm install -g npm@latest` step failed silently                                                        | Check runner logs for that step                               |
| Provenance missing on `@midnightntwrk` tarball       | `id-token: write` not granted, or npm < 11.5.1                                                              | Verify both                                                   |
| Reviewer never prompted on release                   | Environment protection rules misconfigured                                                                  | Settings → Environments → npm-publish-stable → add reviewers  |
| Upstream deps fail to install in CD                  | `MIDNIGHTCI_PACKAGES_WRITE` lacks `read:packages`                                                           | Restore at least `read:packages`                              |

## Packages to configure (14, primary scope)

- `@midnightntwrk/wallet-sdk-abstractions`
- `@midnightntwrk/wallet-sdk-address-format`
- `@midnightntwrk/wallet-sdk-capabilities`
- `@midnightntwrk/wallet-sdk-dust-wallet`
- `@midnightntwrk/wallet-sdk-facade`
- `@midnightntwrk/wallet-sdk-hd`
- `@midnightntwrk/wallet-sdk-indexer-client`
- `@midnightntwrk/wallet-sdk-node-client`
- `@midnightntwrk/wallet-sdk-prover-client`
- `@midnightntwrk/wallet-sdk-runtime`
- `@midnightntwrk/wallet-sdk-shielded`
- `@midnightntwrk/wallet-sdk-unshielded-wallet`
- `@midnightntwrk/wallet-sdk-utilities`
- `@midnightntwrk/wallet-sdk`

To regenerate this list:

```bash
node -e 'const {execFileSync}=require("child_process"),fs=require("fs"),p=require("path");execFileSync("yarn",["workspaces","list","--json"],{encoding:"utf8"}).trim().split("\n").map(JSON.parse).filter(w=>w.location!==".").forEach(w=>{const pkg=JSON.parse(fs.readFileSync(p.resolve(w.location,"package.json"),"utf8"));if(!pkg.private)console.log(pkg.name);});'
```
