# Test Suite Migration Plan

## Overview

This plan covers migrating the remaining standalone test files to the reusable test suite pattern.

**Status: ✅ COMPLETE**

All test suites have been migrated to the reusable pattern. The test suite can now be run against different DApp Connector implementations via the `DappConnectorTestContext` abstraction.

---

## Final Structure

**Test Files:**
- `reference.test.ts` - Unified runner that runs all suites against the reference implementation (198 tests, 7 skipped)
- `errors.test.ts` - Standalone unit tests for APIError class (53 tests)

**Suites (in `suites/` directory):**
- `installation.ts` - Connector installation and injection
- `connection.ts` - Connection and disconnection
- `configuration.ts` - Configuration access
- `addresses.ts` - Address methods
- `balances.ts` - Balance methods
- `signing.ts` - Data signing
- `hintUsage.ts` - Permission hints
- `submission.ts` - Transaction submission
- `proving.ts` - Proving provider
- `history.ts` - Transaction history
- `disconnection.ts` - Disconnection behavior
- `validation.ts` - Input validation
- `transfer.ts` - makeTransfer tests
- `intent.ts` - makeIntent tests
- `balancing.ts` - balanceUnsealedTransaction/balanceSealedTransaction tests

**Total: 251 tests (244 passed, 7 skipped)**

---

## Completed Stages

### Stage 1: Test Environment Abstraction ✅

Added `TestEnvironment` interface providing:
- Network ID for address encoding
- Pre-encoded test addresses (shielded, shielded2, unshielded, unshielded2)
- Optional address keys for decryption-based verification
- Standard token types for testing
- Optional transaction builders for balancing tests

### Stage 2: Transfer Suite ✅

Migrated `makeTransfer` tests (16 tests):
- API contract, result structure, shielded/unshielded/mixed outputs
- Multiple token types, payFees behavior
- Property-based tests with constrained arbitraries
- Insufficient balance scenarios

### Stage 3: Intent Suite ✅

Migrated `makeIntent` tests (20 tests):
- API contract, result structure, input handling
- intentId options (numeric and "random")
- payFees behavior, transaction properties
- Imbalance verification
- Property-based tests with constrained arbitraries
- Insufficient balance scenarios

### Stage 4: Balancing Suite ✅

Migrated `balanceUnsealedTransaction` and `balanceSealedTransaction` tests (18 tests):
- API contract, input validation
- Result structure, balance verification
- DustSpend presence/absence based on payFees
- Transaction structure preservation
- Insufficient balance scenarios

### Stage 5: Cleanup ✅

Deleted old standalone test files:
- addresses.test.ts, balances.test.ts, configuration.test.ts
- connection.test.ts, disconnection.test.ts, hintUsage.test.ts
- history.test.ts, installation.test.ts, signing.test.ts
- submission.test.ts, validation.test.ts, proving.test.ts
- transfer.test.ts, intent.test.ts, balancing.test.ts

Kept:
- errors.test.ts (standalone unit tests)
- reference.test.ts (unified suite runner)

---

## Using the Test Suite

To run tests against a different implementation:

1. Create a context factory implementing `DappConnectorTestContext`:

```typescript
const createMyContext = (): DappConnectorTestContext => ({
  implementationName: 'my-implementation',
  environment: {
    networkId: 'testnet',
    addresses: { shielded: '...', shielded2: '...', unshielded: '...', unshielded2: '...' },
    tokenTypes: { standard: '0...0', alternate: '0...1' },
  },
  installTarget: {},
  createConnector: () => new MyConnector(...),
  createConnectedAPI: async (options) => { ... },
  // Optional methods for implementations that support mocking:
  withBalances: (config) => { ... },
  withTransactionHistory: (entries) => { ... },
  withSubmissionError: (error) => { ... },
});
```

2. Run suites with your context:

```typescript
import { runTransferTests, runIntentTests, ... } from './suites/index.js';

describe('my-implementation', () => {
  describe('transfer', () => runTransferTests(createMyContext()));
  describe('intent', () => runIntentTests(createMyContext()));
  // ...
});
```

Tests that require optional context methods (e.g., `withBalances`) will be skipped if not available.
