---
name: audit
description: >
  Audit this repository's Claude Code configuration (CLAUDE.md, .claude/**, docs/ClaudeCode.md) for rot. Use when the
  user asks to audit/check/verify the Claude config or agent setup, after restructuring .claude/** or CLAUDE.md, or when
  config references look stale. Report findings; do not fix without approval.
---

# Audit the Claude Code configuration

Config rot is invisible: a wrong path in CLAUDE.md throws no error — it just misleads every future session. Sweep the
config layer and report what's broken, stale, or drifting. **Report only** — propose fixes, apply them only after the
user approves.

## Scope

`CLAUDE.md`, `.claude/rules/*.md`, `.claude/skills/**` (including the `wallet-sdk` plugin), `.claude/settings.json`,
`docs/ClaudeCode.md`, `docs/CodingConventions.md`, `scripts/claude/`.

## Mechanical checks

1. **Dead references** — extract every repo file path cited in the scope files (backtick paths, table cells, link
   targets) and verify each exists. Also verify cited external repo paths exist in the shelf cache
   (`~/.agents/shelf/repos/<name>/`) when shelf is installed.
2. **Rule triggers** — every `paths:` glob in `.claude/rules/*.md` must match at least one tracked file
   (`git ls-files`). A rule that never fires is silently dead.
3. **Hooks** — every command in `.claude/settings.json` hooks must resolve: scripts exist on disk, `yarn <task>` tasks
   exist in root `package.json` scripts. Check hook scripts' own references too.
4. **Yarn scripts** — every `yarn x` command mentioned in scope files exists in root `package.json`.
5. **Version claims** — package names/versions asserted in prose (e.g. `@midnight-ntwrk/ledger-vN`) match actual
   dependencies in `packages/*/package.json`.
6. **Skill wiring** — every skill mentioned in scope files corresponds to a real
   `.claude/skills/wallet-sdk/skills/<name>/SKILL.md`; frontmatter and `.claude-plugin/plugin.json` parse; skill
   `description` fields still describe what the skill body does. Flag any `wallet-sdk:<name>` colon syntax (with or
   without a leading slash) anywhere in scope files — it is not a real input format and must not be documented; refer to
   skills by short name plus plugin (e.g. "the `tdd` skill from the `wallet-sdk` plugin").
7. **Size budget** — CLAUDE.md target is ~250 lines / ~2.5k tokens. Flag if it exceeds 300 lines and name the sections
   that grew.
8. **Formatter damage** — scan scope markdown for prettier-mangled structures: code fences or tables collapsed into
   run-on prose lines (compare fence/pipe structure against rendered intent).

## Judgment checks

9. **Rules-vs-docs drift** — `.claude/rules/functional-style.md` is a compression of `docs/CodingConventions.md`, and
   `.claude/rules/testing.md`/`transactions.md` compress conventions stated elsewhere. Read both sides; flag
   contradictions or rules one side has that the other lost.
10. **Stale truths** — are CLAUDE.md's Common Gotchas, Downstream Impact table, and build commands still accurate
    against `turbo.json`, `package.json`, and the CI workflows?

## Report

Group findings by severity: **broken** (points at nothing / would fail), **stale** (factually outdated), **drift** (two
sources disagree). For each: file:line, what's wrong, proposed fix. End with the fixes you recommend applying and wait
for approval.
