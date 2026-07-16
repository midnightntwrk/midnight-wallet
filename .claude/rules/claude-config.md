---
paths:
  - '.claude/**'
---

# Claude Code config — hard rules

- **`.claude/settings.json`** is tracked by git — shared team config (hooks only). **NEVER add `permissions` here**;
  personal permissions go in the gitignored `.claude/settings.local.json`.
- Skills are invoked by short name (`/tdd`, `/changeset`, `/audit`) — never document a `wallet-sdk:name` colon syntax;
  it doesn't exist.
- Setup, hooks, scripts, and troubleshooting reference: `docs/ClaudeCode.md`. After changing this config layer, run the
  `audit` skill.
