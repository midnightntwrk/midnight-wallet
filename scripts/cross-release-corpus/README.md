# Cross-release fixture corpus

Snapshots **written by the last SDK release on the ledger-v8 line**, committed so the dual-ledger build can be replayed
against them forever. They are the durable defence against silent snapshot-format drift: a wallet that upgrades across
the fork restores state written by the version it upgraded from, and nothing else in the suite reads a snapshot that a
real release produced.

## Why this is not a workspace package

It pins `@midnightntwrk/wallet-sdk` to that release and resolves it from npm. That version cannot also be a workspace
dependency — the workspace _is_ the successor of those packages — so this directory keeps its own `package.json` and its
own `node_modules`, and `yarn` at the repository root never sees it. The repository's own build must never reach the
import path here, or the corpus would only prove that the current code agrees with itself.

It therefore differs from `packages/unshielded-wallet/test/fixtures/generate.mjs`, which is the same idea for values the
workspace itself can produce.

## Regenerating

```bash
cd scripts/cross-release-corpus
npm install          # installs the pinned ledger-v8 release
npm run generate     # rewrites the fixtures in place
```

The generator writes each wallet's fixtures into that wallet's own `test/fixtures/cross-release/` directory, beside a
`provenance.json` recording the exact package versions that produced them. **Do not hand-edit a fixture**: a snapshot
that no release ever wrote proves nothing, and the provenance file is what stops a stale one passing as a parity check.

## Changing the pinned version

Only when the "last ledger-v8 release" itself changes. Bump the dependency, reinstall, regenerate, and expect the
fixtures and the provenance to change together in the same commit — a fixture whose provenance did not move is a fixture
someone edited.
