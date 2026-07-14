# What happened between each release train

Companion to [README.md](./README.md)'s version matrix. Each section describes one upgrade boundary: what shipped, what
it did to **persisted data**, what risk it carries, and how this suite covers it. "Persisted data" means the two things
production apps store: wallet snapshots (`serializeState()` output, which embeds ledger binary blobs) and the serialized
tx-history storage.

Sources: git history of this repo (release commits `c3537660` #176, `a1da6462` #232, and the changesets they consumed),
the published npm artifacts themselves (diffed dist-to-dist), and the
[midnight-ledger](https://github.com/midnightntwrk/midnight-ledger) changelogs.

---

## T1 → T2 (Jan 28 → Mar 10) — shielded snapshot drops embedded `txHistory`

|                                       | T1       | T2       |
| ------------------------------------- | -------- | -------- |
| shielded / unshielded / dust / facade | 1.0.0    | 2.0.0    |
| abstractions                          | 1.0.0    | 2.0.0    |
| ledger                                | v7 7.0.0 | v7 7.0.2 |

**What happened:** shielded 1.0.0's snapshot schema had a `txHistory` field — an array of hex-encoded, fully proven
ledger `Transaction`s embedded in the wallet snapshot. 2.0.0 removed the field (tx history left the snapshot with no
replacement until T4).

**Persisted-data effect:** a 1.0.0 snapshot restores _successfully_ under 2.0.0+ — Effect Schema ignores unknown keys —
but the embedded history is **silently destroyed**. No error, no warning. This is data loss, arguably worse than a hard
failure because nothing surfaces it.

**Risk to plan for:** any user who ran the January release and upgraded lost their tx history. If prod reports mention
"history disappeared", this is the boundary.

**Coverage:** `snapshotCompat.test.ts` — T1 fixtures restore (coins survive) and an `it.fails` test documents the
history drop. The T1 fixture embeds two mock-proven transactions, verified readable by 1.0.0 itself.

---

## T2 → T3 (Mar 10 → Mar 20) — the ledger v7→v8 swap, shipped as minor

|                       | T2       | T3                |
| --------------------- | -------- | ----------------- |
| shielded / unshielded | 2.0.0    | 2.1.0             |
| dust / facade         | 2.0.0    | 3.0.0             |
| abstractions          | 2.0.0    | 2.0.0 (unchanged) |
| capabilities          | 3.1.0    | 3.2.0             |
| ledger                | v7 7.0.2 | **v8 8.0.3**      |

**What happened:** the only persisted-format-relevant change is the ledger major swap (changeset `slow-pants-win`
declared it **minor** for every wallet package). The dust/facade major bumps were for a fee-calculation _API_ change
(`wicked-areas-leave`), not data. Not a single SDK snapshot schema changed — published dists differ only in the ledger
import.

**Persisted-data effect:** snapshots embed raw ledger blobs (`ZswapLocalState`, `DustLocalState`), so the question is
whether ledger-v8 reads ledger-v7 bytes. The serialization type tags are identical across v7/v8
(`zswap-local-state[v6]`, `dust-local-state[v1]`, `transaction[v9]`), and empirically every state shape we could
construct cross-deserializes cleanly.

**Risk to plan for:** ledger 8.0.1's changelog declares "**breaking: fix: merkle tree canonicity**" (storage crate
2.0.0: "breaking: fix: MPT canonicity") **without bumping any serialization tag**. If any old state shape is affected,
there is no version signal to detect it — the same bytes are simply interpreted by different code. This is the
_suspected_ boundary for the production incident (the prod app's diff maps exactly to T2→T3), but no failure has been
reproduced. **This is the coverage gap the deep-tree fixtures and the generator's cross-version sweep exist to close.**

**Coverage:** all T2/T3 fixtures restore in current main; generator-side v7→v8.0.3 sweep over aged/deep tree shapes (see
`generate.mjs`).

---

## T3 → T4 (Mar 20 → Apr 23) — external tx-history storage is born

|                       | T3    | T4        |
| --------------------- | ----- | --------- |
| shielded / unshielded | 2.1.0 | 3.0.0     |
| dust                  | 3.0.0 | 4.0.0     |
| facade                | 3.0.0 | 4.0.0     |
| abstractions          | 2.0.0 | **2.1.0** |
| capabilities          | 3.2.0 | 3.3.0     |
| ledger                | v8    | v8        |

**What happened:** PM-19980/PM-22421 — `TransactionHistoryStorage` + `InMemoryTransactionHistoryStorage` appear in
abstractions 2.1.0. Shielded history is reimplemented on it, unshielded refactored onto it (changeset
`ten-windows-return`, majors for shielded/unshielded). Apps now persist a **second** artifact: the serialized tx-history
storage. Its entry schema: `hash` + required `protocolVersion`/`status`, _optional_ `identifiers`, optional
`timestamp`/`fees`. No `lifecycle`. No format-version envelope — a bare JSON array.

**Persisted-data effect:** wallet snapshots unchanged (dists identical apart from the tx-history modules). New persisted
format introduced with no versioning — the seed of the T6→T7 break.

**Risk to plan for:** any future schema change to the entry shape breaks all persisted history wholesale, because
`restore` is an all-or-nothing strict decode of an unversioned payload. That is exactly what T7 did.

**Coverage:** T4 snapshot fixtures restore; T4 tx-history fixtures exercise every field shape the schema allowed (all
three statuses, absent `identifiers`, `fees` null/value/absent, wallet sections).

---

## T4 → T5 (Apr 23 → May 26) — nothing happened to persisted data (why T5 has no fixtures)

|              | T4    | T5                |
| ------------ | ----- | ----------------- |
| shielded     | 3.0.0 | 3.0.1             |
| unshielded   | 3.0.0 | 3.1.0             |
| dust         | 4.0.0 | 4.1.0             |
| facade       | 4.0.0 | 4.0.1             |
| abstractions | 2.1.0 | 2.1.0 (unchanged) |

**What happened:** patch/minor fixes only. Published dists show **zero diff** in any serialization module or tx-history
schema. Abstractions did not even re-release.

**Why no T5 fixtures:** a T5 fixture would be byte-shape-identical to a T4 fixture — same schemas, same ledger, same
encoder code. It would add runtime without adding coverage. If T5 had shipped even a one-field change it would have its
own fixture set. (T6 gets one anyway, as a cheap sanity check that the scope-rename republish really was identical.)

---

## T5 → T6 (May 26 → Jun 19) — the npm scope rename

|              | T5                | T6                |
| ------------ | ----------------- | ----------------- |
| scope        | `@midnight-ntwrk` | `@midnightntwrk`  |
| shielded     | 3.0.1             | 3.0.2             |
| unshielded   | 3.1.0             | 3.1.0 (republish) |
| dust         | 4.1.0             | 4.2.0             |
| facade       | 4.0.1             | 4.1.0             |
| abstractions | 2.1.0             | 2.1.0 (republish) |

**What happened:** CI/packaging change (#479): dual-publish under the new unhyphenated scope. No serialization code
changed.

**Persisted-data effect:** none — verified by fixture (T6 fixtures restore identically to T4's).

**Risk to plan for:** dependency-resolution confusion (two scopes carrying the same code), not data. An app mixing
scopes could end up with two copies of abstractions; `instanceof`-based schema checks across copies could misbehave.
Worth remembering when reading prod dependency trees.

---

## T6 → T7 (Jun 19 → 3.0.0-beta / current main) — the `lifecycle` break and the ledger v9 line

|              | T6    | T7 (beta)                                                 |
| ------------ | ----- | --------------------------------------------------------- |
| shielded     | 3.0.2 | 4.0.0-beta.x                                              |
| unshielded   | 3.1.0 | 4.0.0-beta.x                                              |
| dust         | 4.2.0 | 5.0.0-beta.x                                              |
| facade       | 4.1.0 | 5.0.0-beta.x                                              |
| abstractions | 2.1.0 | **3.0.0-beta.0**                                          |
| ledger       | v8    | **v9 rc** (published beta line; current main is still v8) |

**What happened:** #365 reworked the tx-history entry schema: a required `lifecycle` tagged union
(pending/finalized/rejected) was added, `identifiers` became required, `protocolVersion`/`status` became optional. Dust
gained tx-history sections. Unshielded's snapshot gained a tagged `publicKey` (scheme-aware) — **with** a
legacy-tolerant `Schema.Union` + transform for old string-typed keys (the pattern the tx-history schema lacks). The
published beta line also moved to ledger-v9.

**Persisted-data effect — two confirmed breaks:**

1. Every tx-history payload written by T4–T6 throws `ParseError` under T7 code: `lifecycle` is required and cannot exist
   in old data; entries legally written without `identifiers` fail a second requirement. All-or-nothing decode, no
   migration, no envelope, whole history unreadable.
2. (Beta line only) ledger v8→v9 blob compatibility is untested — same class of risk as T2→T3.

**Risk to plan for:** shipping 3.0.0/T7 GA without a migration guarantees the prod-reported symptom ("storage throws
ParseError on its own prior output") for every upgrading user with tx history. The unshielded `publicKey` handling in
the same train shows the correct pattern to copy.

**Coverage:** `txHistoryCompat.test.ts` — `it.fails` acceptance tests (flip to real when a migration lands) plus a
characterisation test pinning the ParseError to the missing `lifecycle` field.

---

## Summary of open risks, in priority order

1. **T7 `lifecycle` migration missing** — confirmed break, fix before GA. Acceptance tests already in place.
2. **T2→T3 MPT canonicity** — declared breaking upstream, no tag bump, unreproduced. Deep-tree fixtures + sweep target
   it; the prod stack trace would settle it.
3. **T7 ledger v8→v9 blobs** — same risk class as (2) for the beta line; add a v8→v9 sweep when main moves to v9.
4. **T1→T2 silent history loss** — historical; documented by a failing test; only actionable if a migration for
   1.0.0-era snapshots is ever wanted.
5. **Dual-scope `instanceof` hazards** (T5→T6) — watch for mixed-scope dependency trees in prod reports.
