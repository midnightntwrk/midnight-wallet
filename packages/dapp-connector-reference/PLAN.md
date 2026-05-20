# DApp Connector Reference Implementation Plan

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
- `src/test/simulatorTestUtils.ts` boots an in-memory `Simulator` with HD-derived keys, genesis mints (1M of two
  shielded token types + 100k Night), and Night-to-Dust registration; provides a `createSimulatorContext(getEnv)` that
  builds a `DappConnectorTestContext` against a real `WalletFacade`
- Transaction history adapter wraps `WalletFacade.getAllFromTxHistory()` into the `TransactionHistoryServiceView` shape
  via a `Proxy` over the facade
- `MockWalletFacade`/`MockShieldedWallet`/`MockUnshieldedWallet`/`MockDustWallet`, `MockTransactionHistoryService`,
  `buildMock*Transaction`, `MockBalancesConfig`/`MockDustCoin`/`MockHistoryEntry` and the `prepareMock*` helpers all
  deleted from `testUtils.ts` (1194 → 81 lines)
- `withBalances` / `withTransactionHistory` / `withSubmissionError` removed from `DappConnectorTestContext`; suites that
  depended on mock injection deleted their now-unreachable test bodies (65 skip-only tests removed)
- Latent production bug fixed: `ConnectedAPI.getDustBalance` used `state.availableCoinsWithFullInfo(now)` (a mock
  invention); now uses `state.availableCoins` from the real `DustWalletState`
- **Constraint:** the simulator's proving service erases proofs, so the connector's strict
  `Transaction.deserialize('signature','proof','binding', ...)` cannot round-trip simulator-produced transactions. The
  `submission > should submit a valid sealed transaction` test is gated on
  `context.environment.buildSealedTransaction`/`serializeTransaction` being defined; the simulator context omits these
  and the test skips. Real-proving implementations (e.g. a future browser-extension impl) can opt in by providing those
  environment fields.

---

## Upcoming Phases

### Phase 10: Proving Integration (Future)

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
