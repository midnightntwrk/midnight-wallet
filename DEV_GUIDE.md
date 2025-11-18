# Developer Guide

This document is intended for maintainers and contributors to the **Midnight Wallet** repository.  
It describes the internal development and **release management** process used to maintain consistent, automated
versioning and publishing.

---

## 📚 Overview

We use **[Changesets](https://github.com/changesets/changesets)** to handle versioning and changelog generation, and the
**[Changesets GitHub Action](https://github.com/changesets/action)** to automate the creation of release pull requests
and publishing to our package registry.

This setup ensures that:

- Each meaningful change is explicitly versioned.

- Changelogs are consistent and automatically generated.

- Releases are automated, reproducible, and traceable.

---

## Branching Strategy

We use a simple, linear workflow:

- `feat/*` → New features

- `fix/*` → Bug fixes

- `chore/*` → Maintenance and build-related updates

**Rules**

- Open PRs from `feat/*`, `fix/*`, or `chore/*` → merge into `main` after review and green CI.

- Do **not** bump versions or edit changelogs manually — Changesets handles this.

Reserved branch (automated):

- `changeset-release/main` → Created and maintained by the **Changesets GitHub Action**.  
  This branch is used to automatically generate a **“chore: release”** pull request containing:
  - Version bumps for affected packages

  - Updated changelogs

  - (Normally) removal of processed `.changeset` files once a stable release is made

  When this **release PR** is merged into `main`, the same GitHub Action:
  - Publishes new versions to the package registry

  - Pushes git tags for each released version

  - Commits changelog and version updates back to `main`

Behavior of the Automated Release Pull Request:

The Changesets GitHub Action maintains a single automated pull request, typically named `chore: release` — or
`chore: release (<tag>)` during pre-release mode (for example, `chore: release (beta)` or `chore: release (rc)`). It is
created from the latest commit on `main` as a new branch named `changeset-release/main`, which the action updates
automatically to stay in sync with ongoing changes.

**When Left Open**

If the release PR remains open, subsequent merges into main (that include new .changeset files) will automatically
trigger the workflow to update the same PR. In most cases, you won’t see additional commits appear in the PR history —
instead, the existing “version bump” commit is force-pushed with updated content. This happens because the Changesets
Action regenerates the release commit and changelog each time to reflect the latest changes. The PR effectively stays in
sync with main, always representing the next release version.

💡 This is expected behavior — it ensures that you always have a single, up-to-date release PR, rather than many
separate ones.

**When Closed**

If you manually close the release PR without merging, the release branch (`changeset-release/main`) still exists
remotely. The next time the GitHub Action runs (for example, after new commits land on `main`), it will detect that
there are unreleased changes and automatically recreate the PR.

In practice, there’s rarely a reason to close the PR manually — since it will simply be recreated on the next run. The
only valid reason to close it might be to temporarily disable automated releases or clean up stale state — but the PR
will return as soon as the release workflow runs again.

> 💡 During **pre-release (beta) mode**, the `.changeset` files are **not removed** after publishing.  
> They remain in place so that subsequent beta releases (e.g., `1.0.0-beta.1`, `1.0.0-beta.2`, etc.) can be generated
> incrementally.  
> Once the repository exits beta mode, the next stable release will remove all processed `.changeset` files as usual.

---

## Versioning with Changesets

We use **[Semantic Versioning (SemVer)](https://semver.org/)**:

MAJOR.MINOR.PATCH

| Type    | Example | When                               |
| ------- | ------- | ---------------------------------- |
| `major` | `2.0.0` | Breaking changes                   |
| `minor` | `1.2.0` | Backwards-compatible features      |
| `patch` | `1.2.1` | Bug fixes or internal improvements |

---

### How We Manage Versions and Releases

We use the **[Changesets](https://github.com/changesets/changesets)** library to automate versioning and releases.

Changesets helps us:

- Track what changed between releases

- Automatically determine version bumps (major/minor/patch)

- Generate changelogs

- Create automated release pull requests

- Publish new versions

In short, it removes manual version management — developers just describe their changes, and Changesets does the rest.

---

### What Is a “Changeset”?

A **changeset** is a small Markdown file that describes what changed and how it should affect versioning.  
Each changeset acts as a lightweight _"release note draft"_ for the automation system and is stored inside the
`.changeset/` directory.

When you create a changeset using `yarn changeset add`, it automatically generates a uniquely named file (e.g.
`.changeset/bright-shoes-add.md`).

The name is randomly generated to avoid collisions and has no special meaning — the content of the file is what defines
the actual versioning behavior.

Each changeset tells Changesets:

- Which package(s) were affected

- What type of version bump to apply

- A short summary for the changelog

For example:

```markdown
---
'@midnight-ntwrk/wallet-sdk-shielded': patch
---

feat: remove new coins from shielded tx balancer api
```

When merged into main, these .changeset files are picked up by the GitHub Action to:

Generate or update the automated `chore: release` pull request

- Update changelogs

- Prepare new version tags

- Publish packages once the release PR is merged

---

### Adding a Changeset

When your PR introduces a change that should be released, you need to create a Changeset:

```bash
yarn changeset add
```

This is an interactive command that guides you through selecting the affected packages and defining how the release
should behave.

---

Selecting Packages:

When prompted, you’ll see two groups: `changed packages` and `unchanged packages`.

```
🦋  Which packages would you like to include? …
◉ changed packages
  ◉ @midnight-ntwrk/wallet-sdk-shielded
◯ unchanged packages
  ◯ @midnight-ntwrk/wallet-sdk-abstractions
  ◯ @midnight-ntwrk/wallet-sdk-address-format
  ◯ @midnight-ntwrk/wallet-sdk-capabilities
  ◯ @midnight-ntwrk/wallet-sdk-dust-wallet
  ◯ @midnight-ntwrk/wallet-sdk-facade
  ◯ @midnight-ntwrk/wallet-sdk-hd
  ◯ @midnight-ntwrk/wallet-sdk-indexer-client
  ◯ @midnight-ntwrk/wallet-sdk-node-client
  ◯ @midnight-ntwrk/wallet-sdk-prover-client
```

You should generally select only the main parent changed packages. Changesets automatically includes all dependent
internal packages where required.

> ⚠️ While you can select unchanged packages to force a release, this is almost never needed. Changesets automatically
> detects which packages have changed by analyzing their package.json and source content.

Packages that are private or explicitly ignored in the .changeset/config.json will not be included. For example, we
currently ignore test-related packages:

```json
"ignore": ["@midnight/wallet-e2e-tests", "@midnight-ntwrk/wallet-integration-tests"],
```

---

Choosing the Version Bump

After selecting packages, you’ll choose the version bump type:

- major → breaking change

- minor → new feature (backwards-compatible)

- patch → small fix or internal improvement

Then you’ll add a short summary, which will later appear in the generated `CHANGELOG.md` files.

---

### Important: What Happens (and What Doesn’t)

At this stage, no actual version numbers are changed — the .changeset file you create is simply a record of what should
happen during the next release.

When the Changesets GitHub Action later generates the automated release PR (`chore: release`):

- It applies the recorded version bumps to the relevant packages.

- It updates each package’s CHANGELOG.md.

- It also updates dependent packages (if any) to reference the newly bumped versions.

> 💡 Running `yarn changeset add` only creates the release instructions. The real version and dependency updates happen
> automatically inside the release PR.

---

### Running the Check for Missing Changesets

You should generally run `yarn changeset add` at the very end of your PR, once your code changes are complete and ready
for review.

There is a GitHub workflow that validates this — it will fail your PR if changes are detected but no changeset is
present.

You can also verify this locally:

```bash
yarn changeset:check
```

Internally, this runs:

```bash
yarn changeset status --since=origin/main --verbose
```

If packages have changed but no changeset was added, you'll see an error like:

```
🦋  error Some packages have been changed but no changesets were found. Run `changeset add` to resolve this error.
🦋  error If this change doesn't need a release, run `changeset add --empty`.

```

---

### Empty Changesets

If your change doesn’t require a new release — for example, documentation updates, typo fixes, or internal-only changes
— you can add an empty changeset:

```bash
yarn changeset add --empty

```

An empty changeset acts as an explicit acknowledgment that "these changes do not warrant a version bump." It allows CI
checks to pass while keeping release history accurate and intentional.

---

### Pre-release (Beta) Mode

In some cases, we need to publish **pre-release (beta)** versions before making a full stable release — for example, to
share early builds for testing or internal validation.

Changesets supports this workflow through **pre-release mode**, which allows versions such as:

```
1.0.0-beta.1
1.0.0-beta.2
1.0.0-beta.3
```

These are normal semantic versions, but with a pre-release tag (`-beta` in this case).  
This lets us release and iterate on beta versions before promoting the same code to a stable version.

---

#### Checking If You’re in Pre-release Mode

There isn’t a dedicated CLI command that explicitly reports “pre-release mode,” but you can easily verify it by
inspecting the `.changeset/pre.json` file:

```bash
cat .changeset/pre.json
```

- If the file exists and "mode" is set to "pre", the repository is currently in pre-release mode — new versions will be
  published with a prerelease tag (e.g., -beta). The prerelease tag can be confirmed by checking the contents of the
  "tag" attribute in the JSON.

- If the file exists and "mode" is set to "exit", prerelease mode has been exited, and the next release will be a normal
  stable release. The `.changeset/pre.json` file will remain until the next stable release is published, at which point
  it is automatically deleted.

- If the file does not exist, the repository is not in prerelease mode, and all releases are standard stable versions.

---

#### Entering Pre-release Mode

To start publishing beta versions, run:

```bash
yarn changeset pre enter beta
```

The final argument (beta in this case) defines the tag name used for prerelease versions — both for the version suffix
(e.g. `1.0.0-beta.1`) and for the package repository dist-tag. You can use any tag name such as alpha, rc, next, or
preview, depending on your release strategy.

> ⚠️ **Note**: You can only enter prerelease mode if the repository is not already in prerelease mode. If you try to run
> this command while already in prerelease mode, you’ll see an error like:

```
🦋  error `changeset pre enter` cannot be run when in pre mode
🦋  info If you're trying to exit pre mode, run `changeset pre exit`
```

In that case, you must exit pre-release mode first by following the instructions below, under the section _Exiting
Pre-release Mode_.

This command performs the following:

- Enables pre-release mode for the repository.

- Adds a `.changeset/pre.json` file which marks that the project is in pre-release state.

- Tells Changesets and the GitHub Action that all future version bumps should use the selected prerelease suffix (e.g.,
  -beta, -alpha, -rc).

- Keeps `.changeset` files after each release so that new beta versions can continue building on the same set of
  changes.

While in pre-release mode, when the Changesets GitHub Action runs, it will:

- Create or update the automated `chore: release` PR as usual.

- The GitHub Action will create or update the release PR with a title that includes the prerelease tag (e.g.,
  `chore: release (beta)`), indicating that the repository is in prerelease mode.

- Apply version bumps that include the pre-release tag (e.g., 1.3.0-beta.1 → 1.3.0-beta.2).

- Not remove any `.changeset` files after merging — they remain for future beta iterations.

- Publish new versions to the registry using the same tag name for both the version suffix and the npm dist-tag  
  (e.g., a prerelease entered with `beta` produces versions like `1.3.0-beta.1` published under the `beta` dist-tag).

This allows a continuous stream of beta versions without consuming your pending .changeset files.

---

#### Exiting Pre-release Mode

Once you are ready to move from a pre-release version to a stable release, run:

```bash
yarn changeset pre exit
```

This command:

- Updates `.changeset/pre.json` to set "mode": "exit", marking that prerelease mode has been exited.
- Stops generating further prerelease (-beta, -alpha, etc.) versions.
- Prepares the next release to be a normal stable release (no prerelease suffix).

What happens next (on the next stable release PR):

- The Changesets GitHub Action creates a standard `chore: release` PR with stable SemVer versions (e.g., 1.3.0 instead
  of 1.3.0-beta.3).

- The release PR title no longer includes the prerelease tag — it will simply be `chore: release`, indicating a normal
  stable release.

- All relevant `.changeset` files are consumed and removed as part of that PR.

- After the PR is merged and publish completes, `.changeset/pre.json` is deleted automatically  
  _(the file remains with `"mode": "exit"` until that stable release is merged)._

- Packages are published under the default latest dist-tag.

You can re-enter prerelease mode later (for example, starting a new beta, rc or next cycle) by following the section
_Entering Pre-release Mode_.

---

### Simulating the Release Process (Locally)

It can sometimes be helpful to preview what the automated release PR will look like — including version bumps and
generated changelogs — before the GitHub Action runs.

#### ⚠️ Important Notes

Before running any simulation commands, please read carefully:

- **Run on a clean working tree.**  
  Ensure there are no uncommitted changes before running. This command modifies multiple files (`package.json`,
  `CHANGELOG.md`, etc.).

- **Never commit or push these changes.**  
  The simulation is for **local inspection only** and should not be checked in.  
  The real version bumps and changelog updates are applied automatically by the GitHub Action when the release PR is
  created.

- After reviewing the output, you can safely revert your workspace:

  ```bash
  git reset --hard
  ```

### Running the Simulation

You can simulate the release process locally using:

```bash
yarn changeset:version
```

or directly with:

```bash
yarn changeset version
```

This command takes all pending .changeset files and applies the exact same logic that the Changesets GitHub Action would
during the creation of the automated `chore: release` PR. It will:

- Update version numbers in the affected package.json files.

- Update or generate the corresponding CHANGELOG.md entries.

- (In a monorepo) bump any dependent packages automatically.

This allows you to review exactly what will happen once the release PR is created — without pushing or triggering any
automated workflows.

> 💡 This is a great way to verify version bump behavior and generated changelogs before merging your PR — especially
> when working with multiple interdependent packages.
