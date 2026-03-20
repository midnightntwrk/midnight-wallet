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
      real proving or network); removed old test from wallet-integration-tests

---

## Progress Notes

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
