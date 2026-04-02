# Simulator Refactor Plan

This document tracks the planned refactorings for the Simulator module.

## Tasks

### Phase 1: Code Organization

- [x] **1. Extract SimulatorState into a separate file** Move `SimulatorState` type and all pure functions operating on
      it to `SimulatorState.ts`

- [x] **2. Move Simulator.apply to be a function on SimulatorState** Convert static method to a standalone pure function
      in SimulatorState module → Now `applyTransaction` in SimulatorState.ts

- [x] **3. Remove redundant simpleHash, inline into blockHash** Simple cleanup - inline the helper function → Already
      done (no simpleHash exists)

### Phase 2: Pure Functions

- [x] **4. Ensure SimulatorState functions are pure and synchronous** Use `Either` for error reporting instead of
      `Effect`. No async operations in state functions. → All state functions use `Either` for errors

- [x] **5. Refactor #produceBlock to use pure SimulatorState functions** Make `#produceBlock` a simple orchestrator that
      composes pure functions → Uses `processTransactions`, `createBlock`, `createEmptyBlock` from SimulatorState

### Phase 3: Code Quality

- [x] **6. Remove redundant Effect.gen() with single yield\*** Prefer pipes over Effect.gen when there's only a single
      yield → All Effect.gen blocks have multiple yields; no simplification needed

- [x] **7. Fix Ref.get followed by Ref.set/modify anti-pattern** Use `Ref.modify` or `Ref.updateAndGet` atomically
      instead of separate get/set → No anti-patterns found; all usages are valid

### Phase 4: Behavioral Changes

- [x] **8. Make submitTransaction return once transaction is applied** Synchronous confirmation instead of waiting for
      stream events → submitTransaction adds to mempool and waits for block producer via `stateRef.changes`

- [x] **9. Remove sleep/wait patterns** Eliminate `Effect.sleep` and similar waits; use synchronous state updates →
      rewardNight no longer uses sleep; submitTransaction waits via streams

- [x] **10. Refactor rewardNight to use submitTransaction** Update state with reward, then submit claim through
      `submitTransaction` → rewardNight calls submitTransaction and returns the Block

### Phase 5: Cleanup

- [x] **11. Remove old Simulator implementations** Delete old files, update all imports to use
      `@midnight-ntwrk/wallet-sdk-capabilities/simulation` directly → Deleted Simulator.ts from dust-wallet,
      shielded-wallet, and unshielded-wallet

- [x] **12. Ensure no leftovers are left. Investigate shielded, unshielded and dust wallets** Delete old files, update
      imports, update tests. Ensure the code is ready for opening a PR. → All three wallet packages now import directly
      from capabilities; no Simulator.ts re-exports remain

- [x] **13. Ensure there exists a good facade-level example of using a single simulator for whole wallet setup** Ensure
      that the simulator as such does not require any proving and tests can progress relatively quickly, so that it is
      suitable as the base for all dapp-connector tests (which is the ongoing, main task) → Created
      `packages/facade/test/simulation-mode.test.ts` demonstrating full WalletFacade integration with Simulator → Test
      creates sender/receiver facades, performs shielded token transfer, verifies receiver balance → Runs in ~400ms (no
      real proving or network); removed old test from wallet-i.ntegration-init with tests

- [x] 14. **Make genesis mints work with shielded and unshielded tokens** ✓ RESOLVED

      **Final Resolution:** Unshielded genesis mints now work for **custom tokens**. The initial failures were caused by
      two separate issues:

      1. **TTL bug (fixed):** The Intent TTL was set relative to real time (`Date.now()`), but the genesis block time is
         epoch 0. Fixed by using the block time for TTL calculation.

      2. **Night token supply invariant:** Native Night tokens have a fixed total supply (24 quadrillion) enforced by the
         ledger. Attempting to mint Night from nothing violates this invariant.

      **Current Behavior:**
      - **Custom unshielded tokens**: CAN be minted from nothing via genesis (works with `enforceBalancing: false`)
      - **Native Night tokens**: CANNOT be minted from nothing due to supply invariant - use `rewardNight()` instead

      **Test added:** `supports unshielded genesis mints for custom tokens` in Simulator.test.ts

- [x] **15. Remove "mode" from simulator init** Simplified `SimulatorConfig` - if `genesisMints` is provided, use
      genesis mode; otherwise use blank mode. Made `networkId` optional with default `Undeployed`.

- [x] **16. Test "supports custom networkId in genesis mode"** Test uses `custom-test-network-${Date.now()}` to verify
      any string works as networkId, not just well-known values.

- [x] **17. "creates block context from block time"** Extended `nextBlockContext` to accept optional `previousBlockTime`
      parameter. `lastBlockTime` is now calculated from the time difference between blocks (defaults to 1 second). Added
      a new test verifying the calculation.
- [x] **18. Make it possible to receive Night in genesis** Added `NightGenesisMint` type that uses the
      reward/claim mechanism internally. Night claims have a minimum amount requirement (~14077). Tests added for
      standalone Night mints and mixed mints (shielded + unshielded + Night).
- [x] **19. Make block context and block hash more realistic** `blockHash` now takes block number instead of time
      (deterministic, easy to recompute). Added `nextBlockContextFromBlock` that receives whole previous block.
      Legacy `blockHashFromTime` and `nextBlockContext` preserved for backward compatibility.
- [x] **20. Make genesis mints consistent with each other.** Refactored to tagged union pattern:
      `ShieldedGenesisMint`, `UnshieldedGenesisMint`, `NightGenesisMint` all use `type` discriminator.
      Updated all test files to use new format.
- [x] **21. Remove all mentions of 2 modes of simulator** Updated docstrings to describe unified behavior.
      Renamed test describe blocks from "genesis mode"/"blank mode" to "with genesis mints"/"without genesis mints".
- [x] **22. makeTransactions refactored to pure FP** Uses map/filter/reduce pattern, no loops. Pure helper functions
      `toShieldedMint`, `toUnshieldedMint`, `toNightMint` extract mint data. Night mints processed via reduce fold.
- [~] **23. Simulation mode test in facade** (PARTIAL - some issues remain)

      **Completed:**
      - ✓ Extracted setup to helper functions (`createSimulatorWalletFactories`, `makeSimulatorFacade`, `deriveWalletKeys`)
      - ✓ Added Effect cleanup via `Effect.acquireRelease` pattern (facades auto-stop when scope closes)
      - ✓ Simplified main test using new helpers
      - ✓ Added Night genesis transfer test (currently skipped - see below)

      **Remaining issues:**
      - Night transfer test times out waiting for unshielded wallet sync - needs investigation
      - Fee enforcement not yet implemented (test uses `payFees: false`)
      - Transacting capabilities still use simulator-specific variants (deeper refactor needed)
      - genesis mint of night - make recipient a secret key (similarly to how it's with shielded tokens), it removes the need to separately pass recipient and verifying key
- [x] **24. Night genesis mints match real Night definition** Merged `NightGenesisMint` into `UnshieldedGenesisMint`.
      Night tokens auto-detected by comparing `tokenType` against `ledger.nativeToken().raw`. The optional `verifyingKey`
      field is required for Night tokens (used for claim transaction signature). Updated all tests to use new format:
      `{ type: 'unshielded', tokenType: ledger.nativeToken().raw, amount, recipient, verifyingKey }`
- [x] **25. StrictnessConfig in BlockProductionRequest** Added `strictnessOverride?: StrictnessConfig` to `BlockProductionRequest`.
      Block producers can now control strictness at block level. Added:
      - `defaultPostGenesisStrictness`: balancing=true, signatures=true, limits=true, proofs=false
      - `genesisStrictness`: all checks disabled for initial token distribution
      - `strictBlockProducer(fullness)`: convenience block producer that enforces post-genesis strictness
      Tests added for `strictBlockProducer` verifying balancing enforcement.
- [ ] 26 start builders in `packages/facade/test/utils/helpers.ts` from `.withDefaults` - it will reduce amount of boilerplate
- [ ] 27 the simulator test "supports mixed genesis mints (shielded, unshielded, and Night)" should verify that the recipients can indeed receive the tokens
- [ ] 28 remove "strictBlockProducer", it simply needs to be the default block producer
- [ ] 29 make all "toShieldedMint", "toUnshieldedMint", "toNightMint" functions return arrays, so that they can be used in a `flatMap` without filter afterwards, alternatively see if there is a relevant operator, that would allow to do a map returning `Option` and automatically filter the `None` values
- [ ] 30 `Simulator.prototype.#produceBlock` need to just take `BlockProductionRequest`. The strictness in `BlockProductionRequest` should be the default strictness, not an override
- 
- 
    
## Progress Notes

### Session 4: Tasks 16-22 Complete

**Completed:**

- **Task 16**: Verified test uses custom random networkId (`custom-test-network-${Date.now()}`)
- **Task 18**: Added `NightGenesisMint` type using reward/claim mechanism internally. Night claims have minimum amount (~14077).
- **Task 19**: `blockHash` now takes block number (deterministic). Added `nextBlockContextFromBlock` with whole previous block.
- **Task 20**: Refactored GenesisMint to tagged union pattern with `type` discriminator (`'shielded'`, `'unshielded'`, `'night'`).
- **Task 21**: Removed "2 modes" references from docstrings. Test describe blocks renamed to "with genesis mints"/"without genesis mints".
- **Task 22**: Verified `makeInitialTransactions` uses pure FP (map/filter/reduce, no loops).

**New Types:**
- `nextBlockContextFromBlock(previousBlock, blockTime)`: More accurate context from whole block
- `blockHash(blockNumber)`: Deterministic hash from block number

### Session 5: Task 24 Complete

**Completed:**

- **Task 24**: Merged `NightGenesisMint` into `UnshieldedGenesisMint`. Night tokens are now auto-detected by comparing
  `tokenType` against `ledger.nativeToken().raw`. The `verifyingKey` field is optional on `UnshieldedGenesisMint` but
  required for Night tokens (used for claim transaction signature).

**Type Changes:**
- Removed `NightGenesisMint` type
- `UnshieldedGenesisMint` now has optional `verifyingKey?: SignatureVerifyingKey`
- `GenesisMint = ShieldedGenesisMint | UnshieldedGenesisMint` (was three-way union)
- Night detection: `tokenType === nativeToken().raw`

**Test Updates:**
- Updated `Simulator.test.ts` Night genesis tests to use `type: 'unshielded'` with `tokenType: ledger.nativeToken().raw`

### Session 5 (continued): Task 25 Complete

**Completed:**

- **Task 25**: Added `strictnessOverride?: StrictnessConfig` to `BlockProductionRequest`. Block producers can now
  control strictness at the block level, enabling post-genesis balancing enforcement.

**New Exports:**
- `defaultPostGenesisStrictness`: Realistic post-genesis strictness (balancing, signatures, limits enforced; proofs not verified)
- `genesisStrictness`: All checks disabled for genesis block token distribution
- `strictBlockProducer(fullness)`: Convenience block producer using `defaultPostGenesisStrictness`

**API Changes:**
- `BlockProductionRequest` now has optional `strictnessOverride` field
- `immediateBlockProducer(fullness, strictnessOverride?)` accepts optional strictness
- `processTransaction` and `processTransactions` accept optional strictness override

**Test Updates:**
- Added `strictBlockProducer` tests verifying balancing enforcement
- Added test confirming `immediateBlockProducer` allows unbalanced transactions by default

### Session 5 (continued): Task 23 Progress

**Completed:**

- **Task 23** (partial): Refactored simulation-mode.test.ts with helper functions and Effect cleanup

**New Helper Functions (packages/facade/test/utils/helpers.ts):**
- `SimulatorConfig`: Type for simulator configuration
- `createSimulatorProvingService()`: Promise-based wrapper for simulator proving
- `createSimulatorSubmissionService(simulator)`: Promise-based wrapper for submission
- `createSimulatorWalletFactories(config)`: Creates shielded/dust/unshielded wallet factories
- `deriveWalletKeys(hexSeed, networkId)`: Derives all wallet keys from a seed
- `makeSimulatorFacade(config, keys, factories, proving, submission)`: Creates facade with Effect cleanup
- `waitForShieldedCoins(facade)`: Wait for shielded wallet to have coins
- `waitForUnshieldedBalance(facade, tokenType, minBalance)`: Wait for unshielded balance

**Test Improvements:**
- Reduced boilerplate using new helpers
- Effect cleanup via `Effect.acquireRelease` - facades auto-stop when scope closes
- Added Night genesis transfer test (skipped pending unshielded sync investigation)

### Session 3: Task 14 Resolution

**Completed:**

- **Task 14**: Fixed unshielded genesis mints for custom tokens. The issue was NOT about balancing (`enforceBalancing`
  was already `false`). Two bugs were identified and fixed:
  1. **TTL bug**: Intent TTL was set to `Date.now() + 1 hour`, but genesis block is at epoch 0. Fixed by using block
     time for TTL calculation.
  2. **Night supply invariant**: Native Night tokens cannot exceed fixed supply (24 quadrillion). This is a ledger
     constraint, not a simulator bug. Use `rewardNight()` for Night tokens.

### Session 2: Tasks 14-17

**Completed:**

- **Task 15**: Simplified `SimulatorConfig` - removed `mode` discriminator. Genesis mode is now inferred from presence
  of `genesisMints`. Made `networkId` optional with default `Undeployed`.
- **Task 16**: Fixed test to use `NetworkId.Preview` instead of `Undeployed` (which was the default).
- **Task 17**: Extended `nextBlockContext` to accept optional `previousBlockTime` parameter for accurate `lastBlockTime`
  calculation. Added new test for this functionality.

**Additional Fixes:**

- Fixed undefined variable references in `DustWallet.test.ts` (`lastTxNumber`, `walletBalanceBeforeTx`)
- Fixed test timing issue: use actual block timestamps instead of `toTxTime(blockNumber)` when `fastForward` is used

### Session 1: All Tasks Complete

- Extracted SimulatorState.ts with all pure functions
- Created `applyTransaction`, `processTransactions`, `createBlock`, `createEmptyBlock` as pure functions
- `#produceBlock` now uses pure functions from SimulatorState
- `submitTransaction` now adds to mempool and waits for block producer via stream watching
- `rewardNight` uses `submitTransaction` directly, no more sleeps
- Removed old Simulator.ts re-export files from dust-wallet, shielded-wallet, and unshielded-wallet
- Updated all imports to use `@midnight-ntwrk/wallet-sdk-capabilities/simulation` directly
- Enhanced `simulation-mode.test.ts` as reference example for dapp-connector tests
- All tests pass (capabilities, dust-wallet, shielded-wallet, unshielded-wallet, wallet-integration-tests)

## Refactor Complete ✓
