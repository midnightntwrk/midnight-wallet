---
name: shelf
description: >
  Look up how a library, framework, or upstream dependency works by reading its real source from the local shelf cache
  (~/.agents/shelf/repos/{alias}/) instead of web search or stale training data. Use for any "how does X implement Y",
  API-signature, or usage-example question about a dependency — even if the user doesn't mention shelf by name — and
  whenever the user mentions shelf or reference repos. Not for the user's own project code, web searches, or package
  registry queries.
---

# Shelf — Code Reference Repos

Shelf caches reference repositories at `~/.agents/shelf/repos/{alias}/` — local, complete, and version-pinned. Grep and
read them with your native tools (Grep, Read, Glob) instead of searching the web.

## Workflow

1. **Discover** — `shelf list` shows available repos and their local paths. If the repo you need isn't there, ask the
   user whether to add it.
2. **Search** — Grep (or `rg`) the repo path; start broad (a function, type, or keyword), then narrow. Glob for file
   patterns like `~/.agents/shelf/repos/{alias}/**/*.ts`.
3. **Read** — open the files that answer the question.
4. **Synthesize** — answer with file paths and line numbers so the user can verify.

## Commands

| Command                                       | Purpose                                                         |
| --------------------------------------------- | --------------------------------------------------------------- |
| `shelf list`                                  | Show repos with local paths                                     |
| `shelf update [alias]`                        | Sync one or all repos — run before a deep dive (unless pinned)  |
| `shelf add <repo> [--alias name] [--pin ref]` | Add a repo — accepts a registry name, `owner/repo`, or full URL |
| `shelf pin <alias> <ref>`                     | Pin to a branch/tag/commit — match the version the project uses |
| `shelf info <alias>` / `shelf status`         | Detailed info for one repo / all repos                          |
| `shelf install [--dir path]`                  | Clone everything a project's shelffile declares                 |
| `shelf detect [--apply]`                      | Detect repos from project dependencies                          |

Full CLI (remove, prune, share, alias, daemon): `shelf --help`.

## Shelffile

A `shelffile` is a per-project manifest, one repo per line — `alias url [pin:type:value]`:

```
effect https://github.com/Effect-TS/effect.git pin:branch:main
react https://github.com/facebook/react.git pin:tag:v19.0.0
```

`shelf install` clones everything it declares; `shelf share` generates one from your current repos;
`shelf detect --format shelffile` auto-generates from project dependencies.

## Tips

- **Pin for reproducibility** — if the project depends on React 19, pin the reference repo to `v19.0.0` so the code you
  read matches what the project actually uses.
- **Cross-reference with project code** — find a signature in the shelf repo, then grep the user's project for call
  sites.
