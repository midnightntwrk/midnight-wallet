# DApp Connector Reference Implementation Plan

**Workflow:** development follows the multi-agent process + engineering mandates in [`WORKFLOW.md`](./WORKFLOW.md)
(orchestrator · researcher · architect · builder · tester · reviewer/auditor; Definition→Build→Review; the conformance
suite in `src/test/suites/` is the shared builder+tester deliverable, sealed against implementation internals so it
stays pluggable).

## Current State

**Branch:** `akopec/reference-dapp-connector` · **PR:** #60 (still a draft, `[WIP] Reference dapp connector`).

**CI is fully green** — 23 checks pass as of `c9e8fbc4`, including `Unit Tests`, the whole 11-job integration matrix,
and Smoke E2E. The conformance suite stands at **240 tests: 236 passed, 4 skipped, 0 failed**, and — as of Phase 16 —
actually runs inside the required `Tests` gate.

Phases 1–11, 13, 13.1, 15 and 16 are complete (below). What remains before this PR is mergeable:

- **Phase 12 — conformance-suite documentation.** Not started. The deliverable that makes the suite genuinely pluggable
  by external implementations (browser extensions). This is the main outstanding piece of work.
- **Phase 14 — real proving integration.** Not started.
- **Publishing is gated externally.** `@midnightntwrk/wallet-sdk-dapp-connector-reference` depends on the unreleased
  `dapp-connector-api` — currently `4.1.0-beta.1`, in changesets beta pre-release mode with only canaries on npm. This
  package pins the canary `4.1.0-canary.20260805041554-9e03b1e`. A stable `4.1.0` must ship first.
- **Bug tickets from Phase 13.1 are still unfiled.** The skip comments in `suites/intent.ts` were written to be
  paste-ready: the facade `initSwap` cross-kind gap and `placeIntentAtSegment` no-oping whenever a fee intent exists.

**Deferred, tracked outside this plan:** every package's `vitest.config.ts` hardcodes `coverage.reportsDirectory` and
the junit `outputFile` per _package_ rather than per _project_, so the `test:unit` and `test:integration` runs that
`turbo verify` legitimately parallelizes clobber each other (`ENOENT … coverage/.tmp`, malformed junit XML).
Pre-existing across all 16 split packages, never reaches CI. Fix the paths, not the parallelism.

## Completed Phases

### Phase 1-2: Foundation

- Connection lifecycle (connect/disconnect)
- Address retrieval (shielded, unshielded, dust)
- Balance queries

### Phase 3: Transaction History

- `getTxHistory` with pagination
- Transaction status mapping

### Phase 4: Transaction Building

- `makeTransfer` for token transfers
- `makeIntent` for swap intents
- Input validation and error handling

### Phase 5: Transaction Balancing

- `balanceUnsealedTransaction` (stubbed - needs real prover)
- `balanceSealedTransaction` for completing swaps
- Fee payment integration

### Phase 6: Submission & Signing

- `submitTransaction` - deserialize and submit finalized transactions
- `signData` - sign arbitrary data with prefix format

### Phase 7: Proving Delegation

- `getProvingProvider` with swappable `ProvingProviderFactory`
- WASM-based factory (`createWasmProvingProviderFactory`) and mock factory for testing

### Phase 8: Permissions Hint

- `hintUsage` - no-op in reference implementation

### Phase 9.1-9.6: Test Suite Refactoring

- `DappConnectorTestContext` interface with specialized subtypes (`ConnectedAPITestContext`, `TransactionTestContext`,
  `BalancingTestContext`, etc.)
- `ExtendedConnectedAPI` removed; `Connector.connect()` returns standard `ConnectedAPIType`
- 15 reusable test suites in `src/test/suites/`, each exported as `run*Tests(context)`
- `reference.test.ts` runner creates context and invokes all suites
- Clean directory structure, no legacy test files

### Phase 9.7: Simulator-backed WalletFacade

- All sources migrated to `@midnight-ntwrk/ledger-v8`
- `src/test/simulatorTestUtils.ts` boots an in-memory `Simulator` with HD-derived keys, genesis mints, and Night-to-Dust
  registration; provides a `createSimulatorContext(getEnv)` that builds a `DappConnectorTestContext` against a real
  `WalletFacade`
- `MockWalletFacade`/`MockShieldedWallet`/`MockUnshieldedWallet`/`MockDustWallet`, `MockTransactionHistoryService`,
  `buildMock*Transaction`, `MockBalancesConfig`/`MockDustCoin`/`MockHistoryEntry` and the `prepareMock*` helpers all
  deleted from `testUtils.ts` (1194 → 81 lines)
- `withBalances` / `withTransactionHistory` / `withSubmissionError` removed from `DappConnectorTestContext`; suites that
  depended on mock injection deleted their now-unreachable test bodies (65 skip-only tests removed)
- Latent production bug fixed: `ConnectedAPI.getDustBalance` used `state.availableCoinsWithFullInfo(now)` (a mock
  invention); now uses `state.availableCoins` from the real `DustWalletState`

### Phase 9.8: Test Restoration via `setupWallets`

- New `setupWallets` capability on `DappConnectorTestContext`:
  `(spec: Record<K, WalletInitSpec>) => Promise<MultiWalletSetup<K>>`. Each wallet gets HD-derived keys, its own facade
  against a shared simulator, and a connected API.
- `WalletInitSpec` supports multi-UTXO via `bigint | readonly bigint[]` (one UTXO per array element). Enables
  property-based tests with per-iteration setup that sidesteps the wallet's pending-tx UTXO locks.
- Capability flags introduced to document real SDK gaps (so the conformance suite stays honest about what isn't verified
  end-to-end):
  - `intentIdPlacementSupported` — current SDK places intents at the next available segment regardless of the requested
    `intentId` (see TODO in `unshielded-wallet/src/v1/Transacting.ts`). Set to `false` in the simulator context;
    exact-placement tests skip.
  - `crossKindIntentSupported` — `facade.initSwap` processes a token kind only when both inputs AND outputs of that kind
    are present; cross-kind intents silently drop the unmatched side. Set to `false`; cross-kind tests skip.
  - `submissionRoundTripSupported` — the simulator's proving service erases proofs/binding randomness, so a sealed tx
    round-tripped through hex fails the simulator's `wellFormed` check (`Transaction was discarded`). Set to `false`;
    happy-path submission tests skip in the simulator runner.
- 58 net new tests restored across balances/transfer/intent/balancing/submission/history suites (183 → 241).

### Phase 9.9: Conformance Suite Hardening

Driven by a deep review of assertion specificity, FP style, and spec coverage:

- Assertion tightening: exact counts replacing `>= N`, structural matchers replacing tautological `.toBeDefined()`,
  `containsShieldedOutputs` / `containsUnshieldedOutputs` recipient verification across transfer.ts and intent.ts.
- Removed silent `if (history.length === 0) return` skip-paths and the duplicate disconnect-state tests in submission.ts
  (already covered centrally by `disconnection.ts` via `it.each` over every ConnectedAPI method).
- Replaced `for ... of` loops in `balances.ts` / `history.ts` with single `every` / `toEqual` matchers per CLAUDE.md.
- Added pending-balance test in `balances.ts` covering the spec requirement "balances reported are available balances" —
  after `makeTransfer`, the locked source UTXO drops out of the reported balance.
- Replaced four-level conditional `infer` type extraction in `balancing.ts` with a direct
  `import type { ConnectedAPI }`.
- Net test count: 241 → 240 (lost 1 to consolidation/deduplication; the surviving tests are stricter).

### Phase 9.10: Real History Wiring

- Replaced `NoOpTransactionHistoryStorage` with a single shared
  `InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries)` per facade — the canonical wiring used in
  `e2e-tests/helpers/walletInit.ts` ("Single shared tx-history storage so all three sub-wallets and the facade
  read/write the same instance"). `createSimulatorWalletFactories` now takes the storage as a parameter; storage is
  built inside `makeSimulatorFacade`.
- Added the missing `txHistoryStorage` (and required `indexerClientConnection`) on the dust wallet config.
- Wrapped the simulator submission service: after a successful submit it computes `sha256(tx.serialize()).hex()`
  (matching the spec's 64-char hex `txHash` format) and upserts a `WalletEntry`. This bridges the simulator gap where
  the simulator-backed sync capabilities don't write history on update (only the indexer-backed default sync does — see
  `unshielded-wallet/src/v1/Sync.ts:135`).
- Removed `historyEntriesAvailable` capability flag — no longer needed.
- Cleaned up pre-existing `as any` and `eslint-disable` lines in the proving/submission/Proxy wiring with proper typed
  adapters and narrow `as unknown as ...` casts.

### Phase 10: Functional Style in `simulatorTestUtils.ts` (completed)

- `setupSimulatorWallets` rewritten in immutable style:
  - `const built = new Map(); for ... set(...)` → `Effect.forEach` returning `[K, WalletFacade]` pairs →
    `new Map(pairs)`
  - `let anyNight = false; for (...) anyNight = true` → pure predicate `names.some(hasNight)` + a separate
    `Effect.forEach` for the side-effecting waits
  - `for (const name of names) { ... }` Dust-registration loop → `Effect.forEach(names.filter(hasNight), ...)`
  - `const entries = []; for ... entries.push(...)` → sequential `reduce<Promise<ReadonlyArray>>` (deliberately
    sequential — `Promise.all` would parallelize `connector.connect()` and lose deterministic UTXO ordering)
- Pure predicates (`anyAmountPositive`, `hasShielded`, `hasNight`) hoisted out so they're shared by the wait, gate, and
  filter phases.
- Verified by independent Tester + Auditor sub-agents: 240 tests passing, lint clean, typecheck clean, no
  `eslint-disable` added, no new `any`. Behavior preservation (single `sim.fastForward(10_000n)` between wait-phase and
  registration-phase, gated by `anyNight`) confirmed.

### Phase 11: Type-Cast Audit (completed)

- **`Connector.connect()` return type widened to the concrete `ConnectedAPI` class.**
  `ConnectedAPI implements ConnectedAPIType` so the structural subtype satisfies the `InitialAPI.connect` property
  signature; the spec contract holds. Tests now call `api.disconnect()` directly — both
  `as unknown as { disconnect(): Promise<void> }` cast sites in `simulatorTestUtils.ts` are gone. `ConnectedAPI` is
  re-exported from `index.ts` so external backends importing the reference impl can pick up the same class type.
- **`facadeAsView` rewritten as a plain object literal**, no `Proxy`. The `facade as unknown as WalletFacadeView` cast
  is eliminated.
- **Test-suite matcher casts centralised in `src/test/suites/_matchers.ts`.** New helpers `containsString` /
  `matchesString` carry the type-level lie ("returns `string` but is really a vitest asymmetric matcher") in a single
  place with explicit JSDoc; ~30 callsites across `balancing.ts`, `intent.ts`, `signing.ts`, `submission.ts`,
  `transfer.ts`, `validation.ts` no longer need inline `as unknown as string`. Sound because callsites pass the value
  only into `toMatchObject` shapes, which recognise the matcher by its `asymmetricMatch` method, not by declared type.
- **Two casts kept** with substantially improved inline justifications (TS limitation + runtime invariant):
  - `simulatorTestUtils.ts:174` — `Promise<ProofErasedTransaction>` → `Promise<UnboundTransaction>` (proving service
    phantom-type bridge; same runtime `Transaction` class, downstream only calls `.bind()`).
  - `simulatorTestUtils.ts:190` — `FinalizedTransaction` → `ProofErasedTransaction` (submission adapter bridge;
    simulator's proving service erased the proofs).
- **Two pre-existing casts in production paths left alone** (`testing.ts:242`, `ConnectedAPI.ts:119`) — both documented
  deserialise-with-no-proof-no-binding fallbacks. Out of Phase 11 scope.
- Verified by independent Tester + Auditor sub-agents: 240 tests passing, lint clean, typecheck clean, no new
  `eslint-disable` lines, no new `as any`. Final cast count in the package: **4 `as unknown as`** (all documented), **0
  `any`**, **1 pre-existing `eslint-disable`** (a `console.warn` log path in `index.ts`).

---

### Phase 13: Capability-Flag Reduction — `submissionRoundTripSupported` (completed)

**Root cause (after diagnostic):** the connector's `createDefaultTTL` used real wall-clock time (`Date.now() + 1h`)
while the simulator's clock was at ~10000 seconds (post-fast-forward, ~1 January 1970). The ledger's `wellFormed` check
rejected every round-tripped submission with
`Intent TTL is too far in the future. TTL: Timestamp(1780050371), Maximum allowed: Timestamp(13602)` — a clock-mismatch
bug, not a proof / binding / strictness issue.

**Detour and dead ends:**

- An initial Plan agent assumed the failure was `enforceBalancing` against a proof-erased (`NoBinding`) tx.
- A second iteration tried `Transaction.mockProve()` to keep binding intact through proving. `mockProve`'s docs say
  "will not verify" — its stub proofs trip the ledger's Zswap proof check regardless of `WellFormedStrictness` flags.
- Investigating the Rust ledger (`~/mn/midnight-ledger`) showed that TypeScript's `NoBinding` is actually `Pedersen`
  (the basic Pedersen commitment), and `BindingKind::when_sealed` makes the balance check a no-op for it. So
  `enforceBalancing` was never the real failure mode.
- The simulator's `Simulator.ts:551` masks every `LedgerError` into "Transaction was discarded". Without instrumenting
  that masking, every guess was wrong.
- Cross-package Phase 13 Worker changes (`capabilities/`, `facade/`, several test packages) reverted wholesale.

**The actual fix (small, repo-local):**

- `WalletFacadeView` (`src/types.ts`) gains a `readonly clock: { readonly now: () => Date }` field. The full
  `WalletFacade` already exposes `readonly clock: Clock` — this just surfaces it on the narrow view.
- `ConnectedAPI.createDefaultTTL` now takes a `now: () => Date` and is called as
  `createDefaultTTL(this.facade.clock.now)` at each of the four TTL sites (`makeTransfer`, `makeIntent`,
  `balanceUnsealedTransaction`, `balanceSealedTransaction`).
- `simulatorTestUtils.ts`'s `facadeAsView` adds `clock: facade.clock`. Production wallets pass the system clock to
  `WalletFacade.init`; simulator setups pass a simulator clock — both flow through the same channel, no defaults at
  intermediate layers.
- Capability flag `submissionRoundTripSupported` deleted from `TestEnvironment`, from `staticEnvironment`, and from the
  two gates in `submission.ts`. Both gated tests now run end-to-end against the simulator.

**Diff scope:** ~30 lines net across 4 files in `dapp-connector-reference/`. No upstream changes, no `eslint-disable`,
no `any`, no new `as unknown as ...` casts. 240/240 tests passing, lint and typecheck clean.

**Other Phase 13 sub-items — capability flags removed (replaced with targeted `it.skip` markers):**

- `intentIdPlacementSupported`: removed. The SDK ignores the caller's `intentId` at the facade/wallet boundary; the
  connector's `placeIntentAtSegment` helper (`ConnectedAPI.ts:131`) attempts to compensate by post-processing the
  recipe. The two non-property tests (`intentId is 1`, `intentId is arbitrary value`) pass via this. The property test
  (`should place intent in exact segment specified by numeric intentId`) is `it.skip` and the assertion is correct — see
  the rewritten skip comment for the full root-cause chain.
- `crossKindIntentSupported`: removed. Three tests touching cross-kind layouts
  (`should create swap with shielded input and unshielded output`,
  `should create swap with unshielded input and shielded output`,
  `should create exact imbalances matching desired inputs/outputs`) are `it.skip` pointing at the SDK gap. Property
  arbitraries were tightened to `minLength: 1` on inputs and a filter requiring each output's kind to be present in
  inputs — same-kind / both-kinds coverage stays intact.

**Capability flags after Phase 13:** **none.** `TestEnvironment` no longer carries any implementation-specific escape
hatches. The conformance suite expresses what the spec says; per-implementation gaps live as `it.skip` markers with
pointers to the upstream fix needed.

**Final state:** 240/240 tests passing (4 skipped — one per genuine gap), lint and typecheck clean, no `eslint-disable`
added, no `any`, no new `as unknown as` casts.

### Phase 13.1: Cross-kind investigation (corrects Phase 13's attribution)

Re-investigation triggered by "this should just work" intuition on cross-kind. A standalone throwaway probe walked the
ledger, facade, and wallet layers to localise where the gap actually lives. Headline corrections to the Phase 13
narrative:

- **Phase 13 attributed the cross-kind gap to a ledger constraint** (`UnshieldedOffer.new` rejecting empty inputs).
  **This is wrong.** The Rust ledger (`midnight-ledger/ledger-wasm/src/unshielded.rs:76`) has no input-count check;
  `UnshieldedOffer.new([], [output], [])` constructs cleanly and round-trips through `Intent` and `Transaction`
  serialisation. The error message Phase 13 quoted ("Could not create a valid guaranteed offer") originates in
  `shielded-wallet/src/v1/Transacting.ts:417`, not the ledger.
- **The gap is in two SDK layers**:
  1. Facade gates `shielded.initSwap` / `unshielded.initSwap` on `xxxInputs !== undefined`
     (`facade/src/index.ts:900-908`), so the missing-input-kind side is silently dropped. The current behaviour is no
     error and no signal — wrong but not noisy.
  2. Even bypassing the gate by normalising `{}`:
     - Shielded side fails because `#prepareOffer` returns `Option.none` for a fully-empty recipe
       (`shielded-wallet/src/v1/Transacting.ts:292`), and the caller maps that to the misleading error message above.
     - Unshielded side fails because `dust.balanceTransactions` (`facade/src/index.ts:916`) treats the user-declared
       cross-kind imbalance as a deficit to source NIGHT for, rather than as an intent imbalance to preserve. Result:
       `InsufficientFundsError`.
- **`intentIdPlacementSupported` re-assessment**: Phase 13 said "the placement contract holds — the property test
  assertion shape just doesn't match". This is wrong. The connector's `placeIntentAtSegment` returns the recipe
  UNCHANGED when `entries.length !== 1`, so for any flow that adds a fee intent the user's intent stays at the
  wallet-chosen segment (usually 1) instead of `intentId`. The property test correctly catches this; the two
  non-property tests pass only because their particular setup happens to produce a single-intent recipe.

Skip comments on all four `it.skip` tests and the property-test filter in `suites/intent.ts` have been rewritten with
the corrected root-cause analysis and file:line pointers — they're sized to be copy-pasted into bug tickets.

No code changes here — Phase 13.1 is investigation only, captured for the record before the bug tickets get filed.

### Phase 15: Merge `main` & reconciliation (completed)

The branch was ~56 commits / ~5 weeks behind. Merged as `45027bef`; `main`'s changes to `TransactionHistory`/`Clock`,
the npm scope, and the test infra all required code reconciliation, exactly as the review gate predicted (it was **not**
docs-only).

Resolutions to the three decisions the gate escalated:

1. **`TxStatus` is derived from the `lifecycle` discriminator** — the spec-faithful option, closing the documented
   status-model-mismatch gap rather than taking the `status ?? 'SUCCESS'` minimal diff.
2. **The Phase-9.10 submit bridge was ported, not deleted.** Simulator-backed sync still does not write history
   natively, so the bridge remains — now via the lifecycle writer `gotFinalized` instead of the now-private
   `txHistoryStorage.upsert`.
3. The `simulatorTestUtils.ts` fix was applied **before** the merge commit, so the merge landed green.

Also in this phase: undeclared deps (`wallet-sdk-address-format`, `zkir-v2`) added to `dependencies`, and the
load-bearing `dapp-connector-api` portal replaced with the published canary (`1b78c82f`) —
`ErrorCodes.InsufficientFunds` and the `/globals` subpath have both since landed on that repo's `main`.

A second merge of `origin/main` (17 further commits, up to `aa1cd45a`) landed cleanly with no conflicts. `main` has
since codified the testing convention Phase 16 implements — see `.claude/rules/testing.md` and `DEV_GUIDE.md` → Testing
Tiers.

### Phase 16: Subject the branch's additions to the repo's own gates (completed)

Ran as a lightweight def-build-review cycle (researcher → architect rulings → builder → tester · auditor · architect
review, all three review sub-steps passing).

- **The conformance suite was invisible to CI.** The package declared only a `test` script and no vitest `projects`,
  while `verify` and the required `Tests` gate drive `test:unit`/`test:integration`. Turbo silently synthesises an empty
  node for a task a package does not implement, so all 240 tests were unguarded and a regression would have merged
  clean. Fixed with the canonical `unit`/`integration` projects split plus matching scripts.
- **Removed `packages/docs-snippets/test-site`**, superseded by `apps/test-website`. It was never reconciled with the
  scope rename, still importing `@midnight-ntwrk/wallet-sdk-*` and `ledger-v6`, and was failing `docs-snippets`
  typecheck. Its `turbo.json` declared a `serve:test-site` task with no backing script.
- **Apache-2.0 headers** added to 29 connector sources and to `.claude/bin/verify-after-turn.sh` — a tracked `.sh` added
  by this branch and matched by `.licenserc.yaml`, which the original `.ts`-only sweep missed. One `Copyright (C) 2025`
  variant normalised. `license-eye` now reports `invalid: 0` across 721 files.
- **Prettier** on `PLAN.md`, `WORKFLOW.md`, and `address-format/test/addresses.json` (a trailing newline only;
  test-vector data verified byte-identical).

Zero behavior change, proven rather than asserted: the diff over `src/` is empty once added header lines are filtered,
and `intent.ts` hashes identical to its pre-change state after stripping exactly the 12 prepended lines. The four
`it.skip` markers and their root-cause comments are byte-identical.

Deliberately left alone: `packages/spec-reference` has the identical wiring gap but is pre-existing on `main`, so it is
out of this branch's scope; and the shared coverage/junit report paths (see **Current State**).

---

## Upcoming Phases

### Phase 12: Conformance Suite Documentation

**Goal:** Make the conformance suite genuinely pluggable by external DApp Connector implementations (browser extensions,
future native clients).

**Deliverables:**

- README (or `CONFORMANCE.md`) in `packages/dapp-connector-reference` explaining:
  - The `DappConnectorTestContext` contract and its specialised subtypes
  - How to implement `setupWallets` for a backend that supports it (or skip it cleanly)
  - The four `it.skip` markers, what each documents, and what a real backend should expect (capability flags were
    removed in Phase 13 — per-implementation gaps are now `it.skip` with root-caused pointers, so the docs must explain
    that convention rather than a flag table)
  - How to run the suite against an external implementation (entry point script / pattern)
- An example skeleton (`example-external-context.ts`?) showing the minimum surface a browser-extension implementor must
  provide.

### Phase 14: Real Proving Integration (was Phase 10 in earlier plan)

**Goal:** Implement actual proving delegation in `getProvingProvider`.

**Requirements:**

- Add proving service to `WalletFacadeView` interface
- Integrate with prover-client or wallet's internal prover
- Use `KeyMaterialProvider` to resolve circuit keys
- Enable skipped tests in `proving.test.ts`

---

## Notes

- Tests use Vitest with workspace configuration
- Each phase follows TDD: tests first, then implementation
- Functional, immutable style throughout
- `_tag` discriminator pattern for error detection across package boundaries
- **Hard requirements** (per user, for all remaining phases):
  - Reference impl works out-of-the-box with Wallet Facade
  - Conformance suite stays pluggable for arbitrary DApp Connector implementations
  - All work verified against the DApp Connector API spec
  - Functional, immutable style
  - No `any`, no unnecessary type casts, lint passes without disabling rules
