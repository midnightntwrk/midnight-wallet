import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import {
  defaultConnectorMetadataArbitrary,
  randomValue,
  desiredOutputArbitrary,
  deserializeTransaction,
  verifyTransaction,
  hasDustSpend,
} from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import {
  prepareMockFacade,
  prepareMockUnshieldedKeystore,
  testShieldedAddress,
  testUnshieldedAddress,
} from './testUtils.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

describe('makeTransfer', () => {
  const defaultConfig: ConnectorConfiguration = {
    networkId: 'testnet',
    indexerUri: 'http://localhost:8080',
    indexerWsUri: 'ws://localhost:8080',
    substrateNodeUri: 'ws://localhost:9944',
  };

  const createConnectedAPI = async (): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const facade = prepareMockFacade();
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, defaultConfig);
    return connector.connect('testnet');
  };

  // Helper to create valid Bech32m addresses for testing
  const shieldedAddress = MidnightBech32m.encode('testnet', testShieldedAddress).asString();
  const unshieldedAddress = MidnightBech32m.encode('testnet', testUnshieldedAddress).asString();

  // Standard token type (64 hex chars = 256-bit hash)
  const tokenType = '0000000000000000000000000000000000000000000000000000000000000000';

  describe('API contract', () => {
    it('should have makeTransfer method on ConnectedAPI', async () => {
      const connectedAPI = await createConnectedAPI();

      expect(typeof connectedAPI.makeTransfer).toBe('function');
    });
  });

  describe('result structure', () => {
    it('should return deserializable sealed transaction', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
          recipient: shieldedAddress,
        },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs);
      const tx = deserializeTransaction(result.tx);

      expect(tx).toBeDefined();
      expect(typeof tx.bindingRandomness).toBe('bigint');
    });
  });

  describe('shielded outputs', () => {
    it('should create balanced transaction with requested shielded output', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      // Transaction is balanced
      expect(verification.isBalanced).toBe(true);
      // Shielded output count is at least as many as requested
      expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(1);
    });

    it('should create balanced transaction with multiple shielded outputs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
        { kind: 'shielded', type: tokenType, value: 200n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      // Transaction is balanced
      expect(verification.isBalanced).toBe(true);
      // Shielded output count is at least as many as requested
      expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('unshielded outputs', () => {
    it('should create balanced transaction with requested unshielded output', async () => {
      const connectedAPI = await createConnectedAPI();
      const outputValue = 100n;

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: outputValue, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      // Transaction is balanced
      expect(verification.isBalanced).toBe(true);
      // Unshielded outputs match request
      expect(Object.fromEntries(verification.unshieldedOutputs)).toEqual({ [tokenType]: [outputValue] });
      // Unshielded output count is at least as many as requested
      expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(1);
      // Has signatures for unshielded outputs
      expect(verification.hasUnshieldedSignatures).toBe(true);
    });
  });

  describe('mixed outputs', () => {
    it('should create balanced transaction with both shielded and unshielded outputs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
        { kind: 'unshielded', type: tokenType, value: 200n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      // Transaction is balanced
      expect(verification.isBalanced).toBe(true);
      // Unshielded outputs match request
      expect(Object.fromEntries(verification.unshieldedOutputs)).toEqual({ [tokenType]: [200n] });
      // Output counts are at least as many as requested
      expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(1);
      expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multiple token types', () => {
    it('should create balanced transaction with different token types', async () => {
      const connectedAPI = await createConnectedAPI();
      const anotherTokenType = '0000000000000000000000000000000000000000000000000000000000000001';

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
        { kind: 'shielded', type: anotherTokenType, value: 200n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      // Transaction is balanced
      expect(verification.isBalanced).toBe(true);
      // Shielded output count is at least as many as requested
      expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('payFees behavior', () => {
    it('should include DustSpend action when payFees is true (default)', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs);
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(true);
    });

    it('should include DustSpend action when payFees is explicitly true', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs, { payFees: true });
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(true);
    });

    it('should NOT include DustSpend action when payFees is false', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeTransfer(desiredOutputs, { payFees: false });
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(false);
    });
  });

  describe('property-based tests', () => {
    it('should return balanced transaction with correct output counts', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredOutputArbitrary('testnet'), { minLength: 1 }),
          fc.boolean(),
          async (outputs, payFees) => {
            const shieldedCount = outputs.filter((o) => o.kind === 'shielded').length;
            const unshieldedCount = outputs.filter((o) => o.kind === 'unshielded').length;

            const result = await connectedAPI.makeTransfer(outputs, { payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.isBalanced).toBe(true);
            expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(shieldedCount);
            expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(unshieldedCount);
          },
        ),
        { numRuns: 10 },
      );
    }, 30_000); // 30 second timeout for property tests

    it('should include DustSpend iff payFees is true', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredOutputArbitrary('testnet'), { minLength: 1 }),
          fc.boolean(),
          async (outputs, payFees) => {
            const result = await connectedAPI.makeTransfer(outputs, { payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.hasDustSpend).toBe(payFees);
          },
        ),
        { numRuns: 10 },
      );
    }, 30_000); // 30 second timeout for property tests
  });

  describe('insufficient balance', () => {
    it('should reject with InsufficientFunds when wallet lacks shielded balance', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: {}, // Empty shielded balances
        unshielded: {},
        dust: [{ balance: 1000n, maxCap: 1000n }], // Has dust for fees
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
      ];

      await expect(connectedAPI.makeTransfer(desiredOutputs)).rejects.toMatchObject({
        code: 'InsufficientFunds',
        reason: expect.stringMatching(/insufficient|balance/i),
      });
    });

    it('should reject with InsufficientFunds when wallet lacks unshielded balance', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: {},
        unshielded: {}, // Empty unshielded balances
        dust: [{ balance: 1000n, maxCap: 1000n }], // Has dust for fees
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: 100n, recipient: unshieldedAddress },
      ];

      await expect(connectedAPI.makeTransfer(desiredOutputs)).rejects.toMatchObject({
        code: 'InsufficientFunds',
        reason: expect.stringMatching(/insufficient|balance/i),
      });
    });

    it('should reject with InsufficientFunds when wallet lacks dust for fees', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: { [tokenType]: 1000n }, // Has shielded balance
        unshielded: {},
        dust: [], // No dust for fees
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
      ];

      await expect(connectedAPI.makeTransfer(desiredOutputs, { payFees: true })).rejects.toMatchObject({
        code: 'InsufficientFunds',
        reason: expect.stringMatching(/insufficient|dust|fee/i),
      });
    });

    it('should NOT reject for insufficient dust when payFees is false', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: { [tokenType]: 1000n }, // Has shielded balance for outputs
        unshielded: {},
        dust: [], // No dust - but payFees=false so this shouldn't matter
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
      ];

      // Should succeed (or fail for non-dust reasons) - never InsufficientFunds for dust
      const result = await connectedAPI.makeTransfer(desiredOutputs, { payFees: false });
      expect(result.tx).toBeDefined();
    });
  });
});
