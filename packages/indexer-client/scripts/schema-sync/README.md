# schema-sync

The indexer client talks to the Midnight indexer using its GraphQL schema. That schema used to be **copied by hand**
into this package, which silently drifted out of date and broke the client.

`schema-sync` fixes that: it **pins one indexer release**, keeps a **verifiable copy** of that release's schema in
`indexer.gql`, and **generates the TypeScript types** from it. So the schema is always a known, checked version — never
a hand-copied guess.

## Commands

Run from the repo root (`--filter` targets this package; args after `--` go to the tool):

**Verify** — _"is our schema still the real, unmodified schema from the pinned release?"_ Read-only; changes nothing.
Run it any time you want to trust `indexer.gql`. Fails if the file was hand-edited, is stale, or upstream changed under
the tag.

```bash
yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client
```

**`--tag <version>`** — _"use this indexer release instead."_ This is how you upgrade: it downloads that version's
schema, updates the lock, and regenerates the types — all in one step. Pick the version from the indexer's
[releases](https://github.com/midnightntwrk/midnight-indexer/releases).

```bash
yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client -- --tag v4.3.3
```

**`--update`** — _"re-apply the pinned version as-is."_ Re-downloads the pinned tag and rewrites `indexer.gql` and the
generated types from it, without changing the version. Use it to repair a failing `verify` — e.g. restore a hand-edited
`indexer.gql` back to the locked schema — or to regenerate the types after changing the codegen config. (Everything is
committed, so a normal checkout needs nothing regenerated.)

```bash
yarn schema:sync --filter=@midnightntwrk/wallet-sdk-indexer-client -- --update
```

## Files

| File                          | Role                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `schema.lock`                 | **Tool-managed lock** — `repo`, `tag`, `path`, `sha256`. Never hand-edit.                                   |
| `indexer.gql`                 | The schema: a `#` provenance header (source/tag/commit/sha256) + a byte-faithful copy of the upstream file. |
| `src/graphql/generated/`      | Types produced from `indexer.gql` by `graphql-codegen`.                                                     |
| `scripts/schema-sync/sync.ts` | CLI entry — the Effect I/O shell (GitHub API, filesystem, codegen).                                         |
| `scripts/schema-sync/lib/`    | Pure logic (config, hashing, provenance header, decisions, arg parsing) — unit-tested.                      |

## What each command touches

| Command                         | Writes `schema.lock`? | Rewrites `indexer.gql`? |   Regenerates types?    |
| ------------------------------- | :-------------------: | :---------------------: | :---------------------: |
| `schema:sync` (verify, default) |    no (read-only)     |           no            |           no            |
| `--tag <v>`                     |          yes          | only if content changed | only if content changed |
| `--update`                      |          yes          | only if content changed | only if content changed |

The write commands always re-render `schema.lock` (fixed key order) so it stays authoritative — identical values produce
no git diff. When the new schema is byte-identical to the old one (e.g. `v4.0.0` → `v4.0.2`), only the header's
tag/commit is restamped; the body and generated types are untouched.

## `schema.lock` fields

It's a lock, like `yarn.lock` — prefer the CLI over hand-editing. Its four fields fall into two groups:

| Field    | Group                                              | Who changes it                                                     |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `tag`    | **lock** — the pinned version                      | Bump via `--tag`.                                                  |
| `sha256` | **lock** — integrity hash of the raw upstream file | Computed by the tool — **never** hand-edit.                        |
| `repo`   | **source** — where to fetch from                   | Stable; edit only if the upstream repo moves, then run `--update`. |
| `path`   | **source** — schema location in that repo          | Auto-discovered on `--tag`; edit + `--update` if it moves.         |

## Rules

- **`sha256` is the hash of the raw upstream file** (what `shasum -a 256` of the GitHub file gives). `verify` hashes
  `indexer.gql`'s body (header stripped) and compares.
- **Version selection is a deliberate pin.** There is no reliable in-repo "current indexer version" to derive from, so
  the tag is pinned here and bumped intentionally via `--tag`.

## Note on generated types

The codegen uses graphql-codegen's operation-scoped `client` preset: it emits types for the queries and subscriptions we
actually use, not the entire schema. Bare schema object types (e.g. `TransactionResult`) are inlined into operation
types rather than exported by name. If you need a reusable named type for a selection, add a GraphQL **fragment** (the
preset emits `<Name>Fragment` types) rather than reaching for a bare schema type.
