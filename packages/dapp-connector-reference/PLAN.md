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

### Phase 7: Proving Delegation (Stubbed)
- `getProvingProvider` returns "Not implemented"
- Tests outline expected behavior for future implementation

### Phase 8: Permissions Hint
- `hintUsage` - no-op in reference implementation

---

## Upcoming Phases

### Phase 9: Test Suite Refactoring

**Goal:** Make tests reusable across different DApp Connector implementations.

**Pattern:** Follow the approach from [midnight-contracts/dao](https://github.com/midnightntwrk/midnight-contracts/tree/main/packages/dao/api-testing) where test suites are wrapped in functions that accept setup/environment configuration.

#### 9.1: Define Test Context Interface

Create a test context type that implementations provide:

```typescript
export interface DappConnectorTestContext {
  /** Name for test output (e.g., "reference", "browser-extension") */
  implementationName: string;

  /**
   * Factory to create a Connector instance (for installation tests).
   * The connector can be installed via connector.install().
   */
  createConnector: () => Connector;

  /**
   * Factory to create a connected API with disconnect capability.
   * Disconnect is part of test context, not the WalletConnectedAPI interface.
   */
  createConnectedAPI: () => Promise<{
    api: WalletConnectedAPI;
    disconnect: () => Promise<void>;
  }>;

  /**
   * Install target for injection tests (e.g., globalThis or a mock object).
   * Tests can install connectors here via connector.install({ location: installTarget }).
   */
  installTarget: { midnight?: Record<string, InitialAPI> };

  /** Optional: configure mock balances for transfer/intent tests */
  withBalances?: (config: MockBalancesConfig) => void;

  /** Optional: configure transaction history for history tests */
  withTransactionHistory?: (entries: MockHistoryEntry[]) => void;

  /** Optional: configure submission errors */
  withSubmissionError?: (error: Error) => void;
}
```

#### 9.2: Remove ExtendedConnectedAPI

- Move `disconnect()` from `ExtendedConnectedAPI` into the test context
- Tests receive disconnect via context, not the API itself
- The `WalletConnectedAPI` interface remains unchanged
- `Connector.connect()` returns plain `WalletConnectedAPI`

#### 9.3: Wrap Test Suites in Functions

Convert each test file from:
```typescript
describe('someFeature', () => {
  // tests using prepareMockFacade, Connector, etc.
});
```

To:
```typescript
export function runSomeFeatureTests(context: DappConnectorTestContext): void {
  describe(`${context.implementationName}: someFeature`, () => {
    // tests using context.createConnectedAPI() or context.createConnector()
  });
}
```

**Installation tests example:**
```typescript
export function runInstallationTests(context: DappConnectorTestContext): void {
  describe(`${context.implementationName}: installation`, () => {
    beforeEach(() => {
      // Clear install target
      context.installTarget.midnight = {};
    });

    it('should install connector at specified location', async () => {
      const connector = context.createConnector();
      const { uuid } = await connector.install({ location: context.installTarget });

      expect(context.installTarget.midnight![uuid]).toBeDefined();
    });
  });
}
```

**Connected API tests example:**
```typescript
export function runAddressTests(context: DappConnectorTestContext): void {
  describe(`${context.implementationName}: addresses`, () => {
    it('should return shielded addresses when connected', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const addresses = await api.getShieldedAddresses();
        expect(addresses.length).toBeGreaterThan(0);
      } finally {
        await disconnect();
      }
    });
  });
}
```

#### 9.4: Create Implementation-Specific Test Runners

Each implementation has its own test runner file that imports the shared test suites and provides its specific context. The reference implementation uses mocks; other implementations (e.g., browser extension) would use real wallet connections.

**Reference implementation runner (uses mocks):**
```typescript
// reference.test.ts - runs all suites with mock facade/keystore
import { describe } from 'vitest';
import { runInstallationTests, runAddressTests, runBalanceTests, ... } from './suites';

const createReferenceContext = (): DappConnectorTestContext => {
  const facade = prepareMockFacade();
  const keystore = prepareMockUnshieldedKeystore();
  const metadata = randomValue(defaultConnectorMetadataArbitrary);

  return {
    implementationName: 'reference',
    installTarget: {},

    createConnector: () => new Connector(metadata, facade, keystore, defaultConfig),

    createConnectedAPI: async () => {
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const api = await connector.connect('testnet');
      return {
        api,
        disconnect: () => connector.disconnect(), // internal method
      };
    },

    withBalances: (config) => facade.withBalances(config),
    withTransactionHistory: (entries) => facade.withTransactionHistory(entries),
    withSubmissionError: (error) => facade.withSubmissionError(error),
  };
};

// Wrap each suite in describe blocks for easier customization and organization
describe('installation', () => {
  runInstallationTests(createReferenceContext());
});

describe('addresses', () => {
  runAddressTests(createReferenceContext());
});

describe('balances', () => {
  runBalanceTests(createReferenceContext());
});

// ... all test suites
```

**Future browser extension runner:**
```typescript
// browser-extension.test.ts
const createBrowserContext = (): DappConnectorTestContext => ({
  implementationName: 'browser-extension',
  installTarget: globalThis,

  createConnector: () => {
    throw new Error('Browser extension does not expose Connector directly');
  },

  createConnectedAPI: async () => {
    const api = await window.midnight.someWallet.connect();
    return {
      api,
      disconnect: () => window.midnight.someWallet.disconnect(),
    };
  },
});

// Only run applicable tests (skip installation tests for browser)
runAddressTests(createBrowserContext());
runBalanceTests(createBrowserContext());
// ...
```

#### 9.5: Organize Test Structure

```
src/test/
├── suites/                    # Reusable test suite functions
│   ├── installation.ts        # Connector creation & injection
│   ├── connection.ts          # Connect/disconnect lifecycle
│   ├── addresses.ts           # Address retrieval
│   ├── balances.ts            # Balance queries
│   ├── transfer.ts            # makeTransfer
│   ├── intent.ts              # makeIntent
│   ├── balancing.ts           # Transaction balancing
│   ├── submission.ts          # submitTransaction
│   ├── signing.ts             # signData
│   ├── history.ts             # getTxHistory
│   ├── proving.ts             # getProvingProvider
│   ├── hintUsage.ts           # hintUsage
│   ├── configuration.ts       # getConfiguration
│   ├── validation.ts          # Input validation tests
│   ├── disconnection.ts       # Behavior when disconnected
│   ├── errors.ts              # Error code tests
│   └── index.ts               # Re-exports all suites
├── context.ts                 # DappConnectorTestContext type
├── reference.test.ts          # Reference impl test runner
└── testUtils.ts               # Mock factories (reference-specific)
```

#### 9.6: Migration Steps

1. Create `context.ts` with `DappConnectorTestContext` interface
2. Create `suites/` directory
3. For each existing test file:
   - Extract test logic into `suites/<name>.ts` as `run<Name>Tests(context)`
   - Update to use `context.createConnectedAPI()` instead of direct setup
   - Use `context.createConnector()` for installation tests
4. Create `reference.test.ts` that runs all suites with reference context
5. Remove `ExtendedConnectedAPI` - update `Connector.connect()` return type
6. Delete original test files (now in suites/)

---

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
