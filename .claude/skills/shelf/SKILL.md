---
name: shelf
description: >
  Access code reference repositories managed by shelf. Repos are cached at ~/.agents/shelf/repos/{alias}/ and kept in
  sync. Use your native tools (Grep, Read, Glob) to explore them.

  ALWAYS consult this skill before searching for code references, looking up how a library or framework works, grepping
  for implementations, reading source code from a reference repo, checking API signatures, finding usage examples in
  real codebases, or exploring how a dependency is structured.

  Trigger this skill whenever the user mentions code references, reference repos, shelf, grepping a codebase, reading
  library source, "how does X implement Y", "find examples of Z in the codebase", looking up types or interfaces,
  checking an upstream project's code, comparing implementations, or any task that benefits from consulting real source
  code in a cached repository — even if the user doesn't mention "shelf" by name.

  If the user asks you to look something up in a codebase, check an implementation, or find how something works in a
  library, this is the skill to use.

  Do NOT use for the user's own project code (use normal file tools for that), web searches, documentation lookups on
  the internet, or package registry queries.
---

# Shelf — Code Reference Repos

Shelf maintains a local cache of code reference repositories at `~/.agents/shelf/repos/{alias}/`. These repos let you
answer questions about library internals, API surfaces, implementation patterns, and real-world usage — without
searching the web or relying on training data that may be stale.

**Why this matters:** cached reference repos are faster and more reliable than web search for code questions. The code
is local, complete, and version-pinned, so you can grep, read, and explore freely. Whenever a task involves
understanding how a dependency, framework, or upstream project works, check shelf first.

## Quick Start

1. Run `shelf list` to see which repos are available and their local paths.
2. Use your native tools on those paths:
   - **Search**: `Grep` or `rg` on `~/.agents/shelf/repos/{alias}/`
   - **Read files**: `Read` on any file in the repo
   - **Find files**: `Glob` with patterns like `~/.agents/shelf/repos/{alias}/**/*.ts`
   - **Explore structure**: `ls ~/.agents/shelf/repos/{alias}/src/`

## Workflow

When the user asks about code in a reference repository:

1. **Discover** — Run `shelf list` to see available repos and their aliases. If the needed repo isn't there, ask the
   user if they'd like to add it with `shelf add`.
2. **Search** — Use `rg` (ripgrep) or `Grep` to find relevant code. Start broad (e.g., search for a function name, type
   name, or keyword), then narrow down.
3. **Read** — Open the relevant files and read the specific sections that answer the question.
4. **Synthesize** — Explain what you found, referencing file paths and line numbers so the user can verify.

## Management Commands

| Command                                       | Purpose                                       |
| --------------------------------------------- | --------------------------------------------- |
| `shelf list`                                  | Show repos with local paths                   |
| `shelf update [alias]`                        | Sync one or all repos                         |
| `shelf add <repo> [--alias name] [--pin ref]` | Add a repo (accepts name, owner/repo, or URL) |
| `shelf remove <alias>`                        | Remove a repo                                 |
| `shelf detect [--apply]`                      | Detect repos from project dependencies        |
| `shelf install [--dir path]`                  | Install repos from a shelffile                |
| `shelf share [--filter aliases] [--stdout]`   | Generate a shelffile from current repos       |
| `shelf prune [--dry-run] [--force]`           | Remove unreferenced repos                     |
| `shelf status`                                | Show detailed status of all repos             |
| `shelf info <alias>`                          | Show detailed info for a single repo          |
| `shelf pin <alias> <ref>`                     | Pin a repo to a branch, tag, or commit        |
| `shelf alias <old> <new>`                     | Rename a repo alias                           |
| `shelf daemon start`                          | Start background sync daemon                  |
| `shelf daemon stop`                           | Stop the daemon                               |
| `shelf daemon status`                         | Show daemon status                            |

## Adding Repos

You can add repos by name — no full URL required:

\`\`\` shelf add react # resolves from built-in registry shelf add Effect-TS/effect # resolves owner/repo to GitHub
shelf add https://github.com/org/repo.git # full URL \`\`\`

## Shelffile

A `shelffile` is a per-project manifest declaring which reference repos the project needs:

\`\`\`

# one repo per line: alias url [pin:type:value]

effect https://github.com/Effect-TS/effect.git pin:branch:main react https://github.com/facebook/react.git
pin:tag:v19.0.0 \`\`\`

Run `shelf install` in a project directory to clone all repos from its shelffile. Run `shelf share` to generate a
shelffile from your current repos. Run `shelf detect --format shelffile` to auto-generate from project dependencies.

## Tips

- **Pin versions for reproducibility.** If the user's project depends on React 19, pin the reference repo to `v19.0.0`
  so the code you read matches what they're actually using.
- **Update before deep dives.** If you're about to do extensive research in a repo, run `shelf update {alias}` first to
  make sure you're reading the latest code (unless pinned).
- **Combine with project code.** You can cross-reference between the user's project files and shelf repos to trace how
  dependencies are used — e.g., find a function signature in the shelf repo, then grep the user's project for call
  sites.
