# Claude Guide

Guidance for using [Claude Code](https://claude.ai/code) with the **Midnight Wallet** repository. The setup described
here is **Claude-specific** — it lives under `CLAUDE.md` and `.claude/`. If you don't use Claude Code, none of it
matters and you can ignore this file entirely; it does not affect building, testing, or contributing.

---

## What's already set up

- **`CLAUDE.md`** — project instructions Claude Code loads automatically (architecture, conventions, functional-
  programming rules). Nothing to do; Claude reads it for you.
- **`.claude/settings.json`** — shared Claude Code hooks (e.g. a format check after edits). Personal overrides go in
  `.claude/settings.local.json`, which is gitignored.

---

## graphify knowledge graph

[graphify](https://github.com/Graphify-Labs/graphify) builds a local knowledge graph of the codebase that lets Claude
Code navigate it far more efficiently than raw file search. The skill is committed at `.claude/skills/graphify/`, so it
is **active by default in Claude Code**. It stays **optional for the SDK** — building, testing, and contributing never
require it, and if you don't use Claude Code none of it runs.

### Setup — always pre-install first

**Before your first Claude Code session in this repo, install graphify and build the graph yourself.** The skill _will_
otherwise try to do this the first time you ask a codebase question — but don't let it: that auto-install is a bare
`uv tool install graphifyy` which omits `watchdog`, so `yarn graphify:watch` won't work afterwards. Pre-installing gives
you the full toolchain and keeps you in control:

```bash
uv tool install graphifyy --with watchdog   # the binary (requires uv: https://docs.astral.sh/uv/; watchdog enables `graphify:watch`)
graphify hook install                        # git hooks that rebuild the graph on commit/checkout
yarn graphify:update                         # build the initial graph
```

### Keeping the graph fresh

Once built, **keep the graph current as you work** — a stale graph gives Claude worse answers. The simplest way is to
leave `yarn graphify:watch` running (below). The git hooks also rebuild after `git commit` and branch switches, but
**not** after `git merge`, `git pull`, or `git rebase`; after those, refresh it manually. All the helper scripts no-op
with a friendly message if graphify isn't installed:

```bash
yarn graphify:update         # normal refresh (AST-only, no API cost); handles deletions too
yarn graphify:update:force   # only if a plain update warns "Refusing to overwrite" (unexplained node drop)
yarn graphify:watch          # continuous rebuild while editing (like `yarn dist:watch` for builds)
```

`graphify:watch` runs in the foreground and rebuilds the graph on every code change, so it stays current while you work
without waiting for a commit. The commit/checkout git hooks (installed via `graphify hook install`) cover the rest.

### Notes

- The committed skill is **self-activating in Claude Code** — on a codebase question it may build the graph (and
  best-effort install graphify) without being asked. That's why you pre-install (above): do it once and the skill just
  uses your proper install.
- ⚠️ **Do not run `graphify install --platform claude --project`.** The skill is already committed, so you never need it
  — and it **overwrites the committed `.claude/settings.json` PreToolUse hooks with a hardcoded absolute path to _your_
  graphify binary**, dropping the portable `command -v graphify … || true` guard and breaking them for every other
  contributor. If it gets run by accident, before committing either `git checkout .claude/settings.json` to discard the
  change, or `git diff .claude/settings.json` and confirm the hooks still match the portable form (the
  `command -v graphify … || true` guards) — restoring them if not.
