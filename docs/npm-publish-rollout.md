# npm Publish Rollout

One-time playbook for moving CD from GitHub Packages → npmjs with Trusted Publishing + provenance + environment gating.
Delete or convert to a steady-state doc once items below are checked off.

## What changed in the codebase

| File                          | Change                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.changeset/config.json`      | `access: restricted` → `public`                                                                                                                                                                                                                                            |
| `.yarnrc.yml`                 | Dropped `npmPublishRegistry`; install registry for `@midnight-ntwrk` scope still GH Packages (upstream deps live there)                                                                                                                                                    |
| 15× `packages/*/package.json` | `publishConfig.registry` → `https://registry.npmjs.org/`, added `"access": "public"`                                                                                                                                                                                       |
| `package.json` (root)         | `changeset:publish` → `yarn dist:publish && node scripts/publish.mjs && yarn changeset tag`                                                                                                                                                                                |
| `scripts/publish.mjs` (new)   | Iterates non-private workspaces, runs `npm publish --provenance --access public [--tag <tag>]` per package; idempotent via registry version check                                                                                                                          |
| `.github/workflows/cd.yml`    | `id-token: write` on both jobs; `environment: npm-publish-stable` (release) and `npm-publish-canary` (canary); `npm install -g npm@latest` step (Trusted Publishing needs npm 11.5.1+); no `NPM_TOKEN` anywhere; GH Packages PAT retained only for install-time scope auth |

## Rollout checklist

### 1. Pre-flight

- [ ] `@midnight-ntwrk` org exists / is claimed on npmjs.com
- [ ] Decide who can approve stable releases (will be reviewers on the `npm-publish-stable` environment)
- [ ] Confirm `main` branch protection requires PR review

### 2. npmjs side — one-time per package

For each of the 14 publishable packages (see list at bottom), configure **two** pending Trusted Publishers via npmjs.com
→ package or org settings:

- Provider: GitHub Actions
- Owner/Repo: `<owner>/<this-repo>`
- Workflow filename: `cd.yml`
- Environment: `npm-publish-stable` _(entry 1)_ and `npm-publish-canary` _(entry 2)_

Use the **"pending publisher"** option so it works for first-publish of each package. Pending publishers expire
(currently ~30 days on npm), so configure close to first publish attempt.

Docs: https://docs.npmjs.com/trusted-publishers

- [ ] All 14 packages configured with both environments

### 3. GitHub side — one-time

Settings → Environments:

- [ ] Create `npm-publish-stable` with required reviewer(s); optionally restrict to `main` branch via deployment branch
      rules
- [ ] Create `npm-publish-canary` (empty — just needs to exist so the trusted-publisher match works)
- [ ] Narrow / rotate `MIDNIGHTCI_PACKAGES_WRITE` PAT — now only needs `read:packages` scope (CD no longer writes to GH
      Packages)

### 4. Canary smoke test (lower stakes)

- [ ] Merge changes to `main`
- [ ] Watch the `canary` job in the CD workflow run
- [ ] Verify each package publishes; expect provenance attestations
- [ ] If OIDC fails, error log shows the `workflow_ref` value npm received — match the trusted-publisher config to that
      string exactly

### 5. Verify provenance

After a successful canary:

```
npm view @midnight-ntwrk/wallet-sdk@<canary-version>
```

- [ ] `attestations` field present in the metadata
- [ ] `npm audit signatures` passes in a fresh consumer project

### 6. First stable release

- [ ] Open release PR via changesets, merge it
- [ ] CD `release` job blocks on `npm-publish-stable` environment
- [ ] Reviewer approves → job publishes 14 packages + creates git tags
- [ ] Confirm packages visible on npmjs

### 7. Cleanup

- [ ] Delete any leftover `NPM_TOKEN` repo secret (if added earlier)
- [ ] After 2-3 clean releases, convert this doc to steady-state publishing docs or delete

## Failure modes & fixes

| Symptom                                              | Cause                                                                                                       | Fix                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm error 404 ... no such package` on first publish | Package doesn't exist yet and no pending publisher configured                                               | Set up pending publisher on npmjs                             |
| `npm error 403 OIDC token exchange failed`           | Trusted publisher config doesn't match the actual `workflow_ref` (wrong repo / workflow path / environment) | Match config exactly to the `workflow_ref` value in the error |
| `npm publish` reports unsupported npm version        | The `npm install -g npm@latest` step failed silently                                                        | Check runner logs for that step                               |
| Provenance missing on published tarball              | `id-token: write` not granted, or npm < 11.5.1                                                              | Verify both                                                   |
| Reviewer never prompted on release                   | Environment protection rules misconfigured                                                                  | Settings → Environments → npm-publish-stable → add reviewers  |
| Upstream deps fail to install in CD                  | `MIDNIGHTCI_PACKAGES_WRITE` PAT lacks `read:packages` after rotation                                        | Restore at least `read:packages`                              |

## Packages to configure (14)

- `@midnight-ntwrk/wallet-sdk-abstractions`
- `@midnight-ntwrk/wallet-sdk-address-format`
- `@midnight-ntwrk/wallet-sdk-capabilities`
- `@midnight-ntwrk/wallet-sdk-dust-wallet`
- `@midnight-ntwrk/wallet-sdk-facade`
- `@midnight-ntwrk/wallet-sdk-hd`
- `@midnight-ntwrk/wallet-sdk-indexer-client`
- `@midnight-ntwrk/wallet-sdk-node-client`
- `@midnight-ntwrk/wallet-sdk-prover-client`
- `@midnight-ntwrk/wallet-sdk-runtime`
- `@midnight-ntwrk/wallet-sdk-shielded`
- `@midnight-ntwrk/wallet-sdk-unshielded-wallet`
- `@midnight-ntwrk/wallet-sdk-utilities`
- `@midnight-ntwrk/wallet-sdk`

To regenerate this list:

```bash
node -e 'const {execFileSync}=require("child_process"),fs=require("fs"),p=require("path");execFileSync("yarn",["workspaces","list","--json"],{encoding:"utf8"}).trim().split("\n").map(JSON.parse).filter(w=>w.location!==".").forEach(w=>{const pkg=JSON.parse(fs.readFileSync(p.resolve(w.location,"package.json"),"utf8"));if(!pkg.private)console.log(pkg.name);});'
```
