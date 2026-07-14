# Wallet SDK serialization compatibility tests

This package proves (or disproves) that wallet state and transaction history persisted by **previously published SDK
versions** can be restored by the **current workspace code**. It exists because a production wallet app reported a hard
`ParseError` when restoring persisted state after an SDK upgrade.

## Two separate halves

The package deliberately splits into two independent pieces — do not conflate them:

| Half                                    | What it runs against                                                                    | When it runs                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Train tests** (`fixture-generator/`)  | The **published historical versions** (installed via npm aliases, exact ledgers pinned) | Offline, manually, **once per new release train**. Never in CI. |
| **Current-code compat tests** (`test/`) | The **checked-out workspace code** (all imports are `workspace:*`)                      | On every checkout — this is the CI-able gate.                   |

The generator drives each historical version to produce fixtures and **self-checks** them (the version that wrote a
fixture must read it back, or generation fails) — that is the "train" side. The committed fixtures are then frozen
forever. The `test/` suite restores those frozen fixtures through the current packages' public APIs — so on a PR branch
it answers exactly one question: **does this PR's code still read everything previous versions wrote?**

### Running the current-code compat check

```bash
yarn test:serialization
```

This is a root-level script (`turbo run test:unit --filter=@midnight/wallet-serialization-tests`). Turbo's `^dist`
dependency builds the current workspace packages first, and the task hash includes those builds plus `fixtures/**` (see
the package-level `turbo.json`) — so a PR touching any wallet package, or adding a train's fixtures, re-runs the check;
an untouched PR gets a cache hit.

In CI this runs as the dedicated **Serialization Tests** job on every PR (`.github/workflows/ci.yml`), in parallel with
the unit/integration/e2e tiers, and is gated by the aggregate required **Tests** check. The unit-tests CI job excludes
this package so each test runs in exactly one tier. A red `Serialization Tests` job on a PR means the PR changed a
persisted format without a migration.

Note on `it.fails` tests: the known breaks (T1 history drop, T4/T6 lifecycle) are encoded as **expected failures**. If a
PR fixes one (e.g. lands the lifecycle migration), the `it.fails` test flips to red with "expected to fail, but passed"
— that is deliberate signal forcing the author to promote it to a real assertion in the same PR. If a PR introduces a
**new** break, a currently-green restore test goes red. Both directions gate correctly.

## How it works

1. `fixture-generator/` is a **standalone npm project** (deliberately _not_ a yarn workspace member) that installs the
   real published SDK versions via npm aliases, with **each train's exact prod ledger pinned via npm `overrides`**
   (T2→7.0.2, T3/T4→8.0.3, T6→8.1.0 — what apps actually resolved at each release date).
2. Wallet content is produced by a **chain driver** (`fixture-generator/chainDriver.mjs`): each train's own ledger is
   driven through a deterministic on-chain scenario (shielded mints, a dust registration, a night claim that triggers
   real dust generation, and a shielded transfer between a sender and a receiver wallet), and the emitted ledger events
   are replayed through that train's own sync path (`CoreWallet.replayEvents` / `applyEvents`). Fixture wallets
   therefore hold exactly what a synced production wallet held — real merkle trees, SDK-computed `coinHashes`, real
   generated dust — not hand-assembled approximations.
3. The serialized outputs are committed under `fixtures/` — one directory per release train. Every fixture is
   **self-checked at generation**: the version that wrote it must read it back, or generation fails. Published versions
   are immutable, so fixtures never go stale and the generator only runs when a new train is added.
4. `test/` restores every fixture through the current workspace packages' **public APIs**
   (`ShieldedWallet(...).restore`, `UnshieldedWallet(...).restore`, `DustWallet(...).restore`,
   `InMemoryTransactionHistoryStorage.restore`) and asserts that the **content** survives — coin counts, values, pending
   spends, dust UTXOs, registration flags, history entries — not merely that decoding does not throw. (Decode-success
   alone is not enough: the T1→T2 boundary silently _dropped_ embedded tx history without any error.)

### Fixture set per train

| Fixture                     | Contents                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shielded.json`             | Sender wallet after mint + confirmed outgoing transfer (T1: + two embedded mock-proven txs)                                                                                             |
| `shielded-receiver.json`    | Receiver wallet holding the incoming transfer                                                                                                                                           |
| `shielded-pending.json`     | Sender with an unconfirmed local spend (pending spend persisted)                                                                                                                        |
| `shielded-deep.json`        | Sender after 12 rounds of interleaved mints/confirmed spends (deep, gappy commitment tree)                                                                                              |
| `unshielded.json`           | Night UTXO **registered for dust generation** + custom token + pending UTXO                                                                                                             |
| `unshielded-minimal.json`   | Optional fields absent (no `appliedId`, empty pending)                                                                                                                                  |
| `dust.json`                 | Dust wallet with a **real generated dust UTXO** (registration → night claim, event replay)                                                                                              |
| `tx-history.json`           | (T4/T6) every field shape the era's facade `WalletEntrySchema` allowed: all three statuses, `fees` value/null/absent, **absent `identifiers`**, and shielded/unshielded/dust sections   |
| `pending-transactions.json` | (T2+) `PendingTransactions.serialize` payload with mock-proven ledger transactions — the wire schema is versioned and stable, but the embedded tx blobs cross the ledger v7→v8 boundary |

The generator additionally runs an **MPT canonicity sweep** on every invocation: 200 LCG-seeded mint/spend churn rounds
under ledger v7.0.2, cross-deserialized under v8.0.3 every 10 rounds — targeting ledger 8.0.1's undeclared-tag "merkle
tree canonicity" break. Generation fails if any state is rejected.

Tests are plain unit tests (no Docker/network) and run in the normal unit lane.

## Release-train version matrix

All wallet packages are released in lockstep trains. Fixtures are captured once per train that shipped a
persisted-format event (T5 is format-identical to T4; T6 is the scope-rename republish and is captured as a sanity
fixture).

| Train | Date       | shielded     | unshielded   | dust         | facade       | abstractions     | ledger       | Persisted-format events                                                                                                               |
| ----- | ---------- | ------------ | ------------ | ------------ | ------------ | ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| T1    | 2026-01-28 | 1.0.0        | 1.0.0        | 1.0.0        | 1.0.0        | 1.0.0            | v7 7.0.0     | Baseline. Shielded snapshot **embeds `txHistory`** (hexed ledger txs)                                                                 |
| T2    | 2026-03-10 | 2.0.0        | 2.0.0        | 2.0.0        | 2.0.0        | 2.0.0            | v7 7.0.2     | Shielded snapshot **drops `txHistory`** (silent data loss coming from T1)                                                             |
| T3    | 2026-03-20 | 2.1.0        | 2.1.0        | 3.0.0        | 3.0.0        | 2.0.0            | **v8 8.0.3** | Ledger major swap only (declared minor). **Prod incident boundary (T2→T3)**                                                           |
| T4    | 2026-04-23 | 3.0.0        | 3.0.0        | 4.0.0        | 4.0.0        | **2.1.0**        | v8           | External tx-history storage introduced (schema **without `lifecycle`**)                                                               |
| T5    | 2026-05-26 | 3.0.1        | 3.1.0        | 4.1.0        | 4.0.1        | 2.1.0            | v8           | No persisted-format change                                                                                                            |
| T6    | 2026-06-19 | 3.0.2\*      | 3.1.0\*      | 4.2.0\*      | 4.1.0\*      | 2.1.0\*          | v8           | Scope rename republish (`@midnightntwrk`), no format change                                                                           |
| T7    | beta       | 4.0.0-beta\* | 4.0.0-beta\* | 5.0.0-beta\* | 5.0.0-beta\* | **3.0.0-beta\*** | **v9 rc**    | `lifecycle` added to tx-history schema (**known break**), dust tx history added, unshielded key-scheme change (with legacy tolerance) |

\* published under the new `@midnightntwrk` scope; earlier trains under `@midnight-ntwrk`.

Known findings this suite encodes:

- **T1 → T2+**: shielded snapshots restore, but the embedded tx history is silently dropped (asserted as a documented
  failure).
- **T4 tx-history → current (3.x beta line)**: `InMemoryTransactionHistoryStorage.restore` throws `ParseError` because
  the current schema requires `lifecycle` (and `identifiers`), which no 2.x-era payload has. Encoded as `test.fails`
  until a migration lands — via both the storage-level common schema and the app-level facade schema.

Tx-history surface, fully enumerated (every place transaction history or pending transactions is serialized):

1. **T1 embedded snapshot history** — covered (silent-drop expected-fail).
2. **T2–T3**: no tx-history persistence existed in the SDK (in-memory only, dropped from the snapshot at T2).
3. **T4+ `InMemoryTransactionHistoryStorage`** — covered with maxed field-shape fixtures; breaks on `lifecycle` +
   `identifiers`; **section shapes are IDENTICAL from T4 through current main** (pinned by a round-trip control), so a
   migration only needs to synthesize the two missing fields.
4. **T2+ `PendingTransactions` (capabilities)** — public `restore` API, persisted by apps; wire schema is versioned
   (`{version:'v1', …}`) and stable; embedded ledger tx blobs cross v7→v8 cleanly (mock-proven fixtures pass).
5. **Empty payloads** (`[]`) decode under every schema era — the lifecycle break only affects users with non-empty
   history.

## Regenerating fixtures

```bash
cd packages/serialization-tests/fixture-generator
npm ci
node generate.mjs
```

The generator uses fixed seeds, coin values, and block times; only ledger-generated nonces/hashes vary between runs
(content-level assertions are unaffected). Only add new trains; never modify an existing train's fixtures (they
represent what real historical versions wrote). See [BOUNDARIES.md](./BOUNDARIES.md) for what happened between each
train and why T5 has no fixtures.
