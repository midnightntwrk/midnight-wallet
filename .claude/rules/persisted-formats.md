---
paths:
  - 'packages/abstractions/src/TransactionHistoryFormat.ts'
  - 'packages/abstractions/src/TransactionHistoryStorage.ts'
  - 'packages/abstractions/src/InMemoryTransactionHistoryStorage.ts'
  - 'packages/*/src/v1/Serialization.ts'
  - 'packages/*/src/v2/Serialization.ts'
  - 'packages/*/src/SnapshotFormat.ts'
  - 'packages/capabilities/src/pendingTransactions/**'
  - 'packages/serialization-tests/**'
---

# Persisted formats — hard rules

Five strings the SDK hands an application to store and hand back later. An application may hand one back a year after
it was written, by a version we no longer ship.

| Surface | Written by | Format version today |
| --- | --- | --- |
| Shielded snapshot | `shielded-wallet/src/v1/Serialization.ts` and `src/v2/Serialization.ts` | `v1` (both) |
| Unshielded snapshot | `unshielded-wallet/src/v1/Serialization.ts` and `src/v2/Serialization.ts` | `v1` (V1), `v2` (V2) |
| Dust snapshot | `dust-wallet/src/v1/Serialization.ts` and `src/v2/Serialization.ts` | `v1` (both) |
| Transaction history | `abstractions/src/InMemoryTransactionHistoryStorage.ts` | `v2` |
| Pending transactions | `capabilities/src/pendingTransactions/pendingTransactions.ts` | `v1` |

The three snapshot surfaces have two writers each — the V1 variant on ledger-v8 and the V2 variant on ledger-v9 — and
each package keeps its version constants, and any upgrade step, in a ledger-free `src/SnapshotFormat.ts` that both
twins import. A change to either twin's writer is a change to a persisted format.

Full reasoning: ADR [0008](../../docs/decisions/0008-persisted-format-versioning.md). Glossary: `docs/Design.md`.

## The promise

- Every format version shipped in a **stable** release loads in every later stable release. Dropping one is a breaking
  change.
- **No downgrade.** A reader meeting a version it does not know refuses the payload and names the version it found.
- A format that only existed on a pre-release tag carries **no** promise. It must still not be corrupted if it loads.

## Changing a persisted shape

**Bump the version** when a required field is added, or a field is removed, renamed, or changes type. Then, in the same
pull request:

1. Add the new version to the surface's version constants in the package's `src/SnapshotFormat.ts`.
2. Add **one** upgrade step, `vN` → `vN+1`. Steps chain and never skip.
3. Add a fixture folder for the version being left behind, if it does not already have one. Fixtures are produced by
   running the real published release, never written by hand: `packages/serialization-tests/fixture-generator/README.md`.
4. Re-record the drift baseline: `yarn capture`.

**Do not bump** when adding an optional field. Re-record the baseline and commit the diff.

Ledger blob internals are the ledger's concern, not a format version of ours.

## Writing an upgrade step

- It is a **pure function on the encoded JSON**, before any schema runs, so wallet packages that extend an entry shape
  need no change of their own.
- **Fill in what is missing; never overwrite what is there.** This is what makes a step safe to apply to a payload it
  has already touched, and it is the rule that stops an upgrade destroying data that was already correct.
- **Never invent a value that was not recorded.** Synthesise only what is knowable. If a reader needs something the old
  format never stored, it fetches it — or fails — at the point of use.
- Once released, a step is **frozen**. Write it once; a later change means another version, not an edit.

## Never

- **Never edit a file under `packages/serialization-tests/fixtures/<surface>/<version>/`.** Those record what a shipped
  SDK actually wrote. If a test fails, fix the code — editing the fixture makes the test pass and the bug ship. CI
  blocks this (`check-frozen.mjs`).
- **Never swallow an unreadable payload into an empty store.** Raise the tagged error. Losing a history silently is
  worse than failing to open it.
- **Never widen a schema to make an old payload decode** without an upgrade step. Optional-everything reads anything
  and tells you nothing.

## Tests that must stay green

Run: `yarn test:unit --filter=@midnight/wallet-serialization-tests`

| File | Question it answers |
| --- | --- |
| `*Compat.test.ts` | Does real stored data still load, with the right content? |
| `formatDrift.test.ts` | Has what we write changed since it was last recorded? |
| `formatVersionCoverage.test.ts` | Is every version the code declares backed by a fixture? |

Assert **content** — balances, entries, lifecycle, sections — never just "it did not throw". A no-throw assertion
passes against implementations already known to be wrong.
