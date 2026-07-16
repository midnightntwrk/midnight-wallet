# Claude Code Setup

Recommended Claude Code configuration for developers working on this repository.

## Settings file scopes

Claude Code merges settings from several files. Know which one you're editing:

| File                          | Scope               | Tracked by git  | What goes here                                         |
| ----------------------------- | ------------------- | --------------- | ------------------------------------------------------ |
| `.claude/settings.json`       | This repo, everyone | **Yes**         | Shared team config (hooks only). **No `permissions`.** |
| `.claude/settings.local.json` | This repo, just you | No (gitignored) | Your personal repo-scoped permissions                  |
| `~/.claude/settings.json`     | All repos, just you | No              | Your personal global permissions (see below)           |

The tracked `.claude/settings.json` must never contain a `permissions` block — permissions are personal and belong in
one of the other two files.

## Recommended permissions

These are recommendations, not enforced by the repo. Put them in your **user-level** `settings.json` so they apply
everywhere, not just in this repo.

### Deny: never let Claude read secrets

```json
"permissions": {
  "deny": [
    "Read(//**/.env)",
    "Read(//**/.env.*)",
    "Read(//**/secrets/**)",
    "Read(//**/*.pem)",
    "Read(//**/*.key)",
    "Read(//**/*.p12)",
    "Read(//**/id_rsa)",
    "Read(//**/id_ed25519)",
    "Read(//**/.npmrc)",
    "Read(//**/.netrc)",
    "Read(//**/.zshenv.local*)",
    "Read(//**/.zshrc.local*)",
    "Read(~/.ssh/**)",
    "Read(~/.aws/**)",
    "Read(~/.config/gcloud/**)",
    "Read(~/.gnupg/**)"
  ]
}
```

### Ask: gate outward-facing git/GitHub actions

Prompt-based rules ("always ask before committing" in a CLAUDE.md) are advisory — the agent can drift. Permission rules
are mechanical: the tool call is intercepted and you approve or reject it every time.

```json
"permissions": {
  "ask": [
    "Bash(git commit:*)",
    "Bash(git push:*)",
    "Bash(gh pr create:*)",
    "Bash(gh pr edit:*)",
    "Bash(gh issue create:*)",
    "Bash(gh issue edit:*)",
    "Bash(gh pr comment:*)",
    "Bash(gh issue comment:*)"
  ]
}
```

With these in place, commits, pushes, and the creation, editing, or commenting on PRs and issues always stop for your
explicit approval, regardless of what any CLAUDE.md says.

## Hooks (tracked, apply to everyone)

The tracked `.claude/settings.json` configures team-wide hooks:

- **Auto-format on edit** (`PostToolUse`) — after every `Edit`/`Write`, `yarn format:changed` formats all changed files
  (~0.5 s). Note it covers every changed file in your working tree, including ones you edited manually — not just the
  file Claude touched.
- **Verify on stop** (`Stop`, `scripts/claude/hook-stop-verify.mjs`) — when Claude tries to end its turn,
  `yarn verify:changed` runs (format + typecheck + lint of changed packages via turbo + Effect diagnostics on changed
  files). On failure the stop is blocked and the errors are fed back, so Claude must fix its work before finishing. A
  `stop_hook_active` guard lets the second consecutive failure through, so an unfixable error surfaces to you instead of
  looping forever.

Lint and typecheck run on `Stop` rather than per edit, deliberately: turbo caching cannot help the package being edited
(the edit itself invalidates that package's cache), so a per-edit lint hook would pay a full `tsc` + type-aware-ESLint
run on every keystroke — and mid-turn code is often legitimately half-finished (a red TDD test, a multi-file refactor in
progress). Once per turn is the right cadence.

## Skills — the `wallet-sdk` plugin

Repo skills ship as a **plugin** at `.claude/skills/wallet-sdk/` (manifest: `.claude-plugin/plugin.json`), which gives
them a namespace — they can never collide with your personal `~/.claude/skills/`. The plugin auto-loads for everyone who
clones the repo, after the workspace trust prompt; zero setup.

> **If the plugin's skills don't show up** (type `/wallet` — `tdd`, `changeset`, and `audit` should appear, labelled
> `(wallet-sdk)`), diagnose with `claude plugin list`:
>
> - After pulling the plugin into an already-scanned checkout: run `/reload-plugins` or relaunch.
> - If it reports the workspace "was not trusted when plugins were scanned": plugin loading is gated on
>   `hasTrustDialogAccepted` for the project in `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json` if you set that
>   variable) — and for **git worktrees** the flag is read from the **main checkout's** entry. Known bugs can leave it
>   `false` even though sessions start without a trust prompt (anthropics/claude-code#36403, #9113). Fix: set it to
>   `true` for the main checkout's path, then start a fresh session — trust is only read at startup; `/reload-plugins`
>   won't pick it up.

**Using the skills:** type `/wallet-sdk` to list all of this plugin's skills, or type a skill name directly (e.g.
`/tdd`) — if you also have a personal skill with the same name, both appear; pick the one labelled `(wallet-sdk)`.

- `/tdd` — the TDD loop for SDK work: choose test type (unit vs integration suffix) → design → write → observe **red**
  for the right reason → **user gate** (you review/commit the test) → implement → observe **green** → review → refactor.
  The agent also self-invokes it for feature/bug-fix requests based on the skill description.
- `/changeset` — create a changeset non-interactively (`yarn changeset add` is an interactive CLI an agent can't drive):
  package selection, SemVer bump judgment, file format, empty-changeset case, `yarn changeset:check`.
- `/audit` — audit the Claude Code config itself (CLAUDE.md, rules, skills, hooks, this file) for rot: dead file
  references, rule globs that match nothing, missing scripts/yarn tasks, stale version claims, rules-vs-docs drift.
  Report-only; run it after restructuring `.claude/**` or when config references look stale.

## Format/lint convenience scripts

Defined in the root `package.json`, usable by humans and hooks alike:

- `yarn changed-files` — print files changed vs `HEAD` (including untracked), one per line
  (`scripts/changed-files.mjs`). Generic building block: pipe it into anything that takes a file list.
- `yarn format:file <files…>` — format specific files.
- `yarn format:changed` — `changed-files` piped into `format:file`; what the edit hook calls.
- `yarn lint:changed` — `turbo run lint --affected`: lints only packages changed vs the base branch (including
  uncommitted changes), and — because `lint` depends on `^dist` and `typecheck` — turbo builds dependencies first, so
  results are type-correct. Cached; the first run in a fresh worktree pays the build cost once.
- `yarn els:changed` — `@effect/language-service` diagnostics on changed `packages/**` TypeScript files
  (`scripts/els-changed.mjs`). Works without built `dist/` (rules resolve types from the `effect` package itself). ⚠️
  `deterministicKeys` is temporarily downgraded to "off" in this script: `main` has ~22 pre-existing violations whose
  fix renames runtime `_tag` strings — a breaking change for consumers matching on tags. Cleanup is tracked in #577;
  remove the override once it lands.
- `yarn verify:changed` — `format:changed`, then `lint:changed`, then `els:changed`. Format runs first on purpose: the
  ESLint config includes `eslint-plugin-prettier`, so unformatted code shows up as lint errors — formatting first clears
  those before lint runs.

## Effect Language Service — manual usage

`@effect/language-service` provides Effect-specific diagnostics (floating effects, wrong yield usage, deterministic
keys, …), configured as a TypeScript plugin in `tsconfig.base.json`. The Stop hook runs it automatically via
`yarn els:changed`; to run it by hand:

```bash
# Single file (always absolute paths — prefix with $(pwd)/)
yarn effect-language-service diagnostics --file "$(pwd)/path/to/file.ts" --format pretty

# Whole package — must use tsconfig.build.json or tsconfig.test.json, NOT tsconfig.json
# (the latter only has references, no source files)
yarn effect-language-service diagnostics --project "$(pwd)/packages/dust-wallet/tsconfig.build.json" --format pretty
```

Other subcommands: `quickfixes` (report-only diffs), `codegen` (applies `@effect-codegens` directives — writes changes),
`overview`, `layerinfo`.

## Code reference repos (shelf)

Optional but recommended: [shelf](https://github.com/Rika-Labs/shelf) caches the upstream reference repos declared in
`shelffile` (the midnight specs, `effect`, the language-service) locally under `~/.agents/shelf/repos/` for fast agent
access — the `shelf` skill then reads them there instead of the web. Install: `bun install -g @rikalabs/shelf`, then
`shelf install` from the repo root.
