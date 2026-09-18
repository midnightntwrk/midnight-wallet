---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

Name the unshielded snapshot shape the V2 variant writes: format version `v2`.

The V1 variant, on ledger-v8, stores the verifying key as a bare string, implicitly a schnorr key. The V2 variant, on
ledger-v9, stores it as `{ tag, value }` because that ledger signs with more than one scheme. A field that changes type
is a new format version, so a snapshot written by the V2 variant now carries `version: 'v2'`. The V1 variant still
writes `v1`.

Reading is one step: a `v1` snapshot handed to the V2 variant has its key tagged as schnorr before the schema runs, and
nothing else about it is touched. Snapshots written by the `4.0.0` pre-releases, which had the tagged key and no
`version`, read as `v2`. A snapshot carrying a version this build does not know is refused, naming the version.

Both variants' snapshot writers are now covered by the persisted-format gate — drift baselines, coverage and
information-preservation run per writer — and each package keeps its format versions in a ledger-free
`src/SnapshotFormat.ts` shared by both variants. Rules and reasoning: `docs/decisions/0008-persisted-format-versioning.md`.
