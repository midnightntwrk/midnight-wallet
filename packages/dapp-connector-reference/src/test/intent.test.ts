import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import {
  defaultConnectorMetadataArbitrary,
  randomValue,
  tokenTypeArbitrary,
  desiredInputArbitrary,
  desiredOutputArbitrary,
  deserializeTransaction,
  verifyTransaction,
  computeExpectedImbalances,
  hasDustSpend,
  getTotalFees,
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

describe('makeIntent', () => {
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
  const anotherTokenType = '0000000000000000000000000000000000000000000000000000000000000001';

  describe('API contract', () => {
    it('should have makeIntent method on ConnectedAPI', async () => {
      const connectedAPI = await createConnectedAPI();

      expect(typeof connectedAPI.makeIntent).toBe('function');
    });
  });

  describe('result structure', () => {
    it('should return deserializable sealed transaction', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: anotherTokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx).toBeDefined();
      expect(typeof tx.bindingRandomness).toBe('bigint');
    });
  });

  describe('input handling', () => {
    it('should create swap with shielded input and unshielded output with exact imbalances', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: anotherTokenType, value: 50n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
      const verification = verifyTransaction(deserializeTransaction(result.tx));
      const expectedImbalances = computeExpectedImbalances(desiredInputs, desiredOutputs);

      // Imbalances match expected
      expect(Object.fromEntries(verification.imbalances)).toEqual(Object.fromEntries(expectedImbalances));
      // Unshielded outputs match request
      expect(Object.fromEntries(verification.unshieldedOutputs)).toEqual({ [anotherTokenType]: [50n] });
      // Output counts are at least as many as requested
      expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(1);
      // DustSpend present (payFees=true)
      expect(verification.hasDustSpend).toBe(true);
    });

    it('should create swap with unshielded input and shielded output with exact imbalances', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'unshielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: anotherTokenType, value: 50n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
      const verification = verifyTransaction(deserializeTransaction(result.tx));
      const expectedImbalances = computeExpectedImbalances(desiredInputs, desiredOutputs);

      // Imbalances match expected
      expect(Object.fromEntries(verification.imbalances)).toEqual(Object.fromEntries(expectedImbalances));
      // Shielded output count is at least as many as requested
      expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(1);
      // DustSpend present (payFees=true)
      expect(verification.hasDustSpend).toBe(true);
    });

    it('should create balanced swap with multiple inputs and outputs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        { kind: 'shielded', type: tokenType, value: 100n },
        { kind: 'unshielded', type: anotherTokenType, value: 50n },
      ];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: 100n, recipient: unshieldedAddress },
        { kind: 'shielded', type: anotherTokenType, value: 50n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
      const verification = verifyTransaction(deserializeTransaction(result.tx));
      const expectedImbalances = computeExpectedImbalances(desiredInputs, desiredOutputs);

      // Imbalances match expected (both should be 0n for this balanced swap)
      expect(Object.fromEntries(verification.imbalances)).toEqual(Object.fromEntries(expectedImbalances));
      // Unshielded outputs match request
      expect(Object.fromEntries(verification.unshieldedOutputs)).toEqual({ [tokenType]: [100n] });
      // Output counts are at least as many as requested
      expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(1);
      expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('intentId option', () => {
    it('should accept intentId as "random" and place in non-zero segment', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: tokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx.intents).toBeDefined();
      // Segment 0 is reserved for guaranteed section, intent must be in segment > 0
      expect(tx.intents!.has(0)).toBe(false);
      expect(tx.intents!.size).toBeGreaterThan(0);
    });

    it('should accept intentId as numeric value (segment 1)', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: tokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 1,
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx.intents).toBeDefined();
      // Intent should be placed in segment 1
      expect(tx.intents!.has(1)).toBe(true);
    });

    it('should accept intentId as numeric value (arbitrary segment)', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: tokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 5,
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx.intents).toBeDefined();
      // Intent should be placed in segment 5
      expect(tx.intents!.has(5)).toBe(true);
    });
  });

  describe('payFees option', () => {
    it('should include DustSpend when payFees is true', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: tokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(hasDustSpend(tx)).toBe(true);
      expect(getTotalFees(tx)).toBeGreaterThan(0n);
    });

    it('should NOT include DustSpend when payFees is false', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: tokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: false,
      });

      const tx = deserializeTransaction(result.tx);
      expect(hasDustSpend(tx)).toBe(false);
    });
  });

  describe('transaction properties', () => {
    it('should return sealed transaction (cryptographically bound)', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: anotherTokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx.bindingRandomness).toBeDefined();
      expect(typeof tx.bindingRandomness).toBe('bigint');
    });

    it('should return transaction with proofs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: anotherTokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      // Deserialization with 'proof' marker succeeds means transaction has proofs
      const tx = deserializeTransaction(result.tx);
      expect(tx).toBeDefined();
    });

    it('should return transaction with valid TTL', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
        },
      ];

      const desiredOutputs: DesiredOutput[] = [
        {
          kind: 'unshielded',
          type: anotherTokenType,
          value: 100n,
          recipient: unshieldedAddress,
        },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      const verification = verifyTransaction(deserializeTransaction(result.tx));
      expect(verification.hasValidTtl).toBe(true);
    });
  });

  describe('imbalance verification', () => {
    it('should create exact imbalances matching desired inputs/outputs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: anotherTokenType, value: 50n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
      const verification = verifyTransaction(deserializeTransaction(result.tx));
      const expectedImbalances = computeExpectedImbalances(desiredInputs, desiredOutputs);

      expect(Object.fromEntries(verification.imbalances)).toEqual(Object.fromEntries(expectedImbalances));
    });

    it('should have exact imbalances for shielded inputs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: anotherTokenType, value: 75n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(Object.fromEntries(verification.imbalances)).toEqual({
        [tokenType]: -100n,
        [anotherTokenType]: 75n,
      });
    });

    it('should aggregate imbalances for multiple inputs and outputs of same token', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        { kind: 'shielded', type: tokenType, value: 100n },
        { kind: 'shielded', type: tokenType, value: 50n },
      ];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: anotherTokenType, value: 75n, recipient: unshieldedAddress },
        { kind: 'unshielded', type: anotherTokenType, value: 25n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
      const verification = verifyTransaction(deserializeTransaction(result.tx));
      const expectedImbalances = computeExpectedImbalances(desiredInputs, desiredOutputs);

      // Total input: 150n of tokenType → imbalance -150n
      // Total output: 100n of anotherTokenType → imbalance +100n
      expect(Object.fromEntries(verification.imbalances)).toEqual(Object.fromEntries(expectedImbalances));
    });
  });

  describe('property-based tests', () => {
    const intentIdArbitrary = fc.oneof(fc.constant('random' as const), fc.integer({ min: 1, max: 255 }));

    it('should have DustSpend iff payFees is true', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredInputArbitrary, { minLength: 1, maxLength: 5 }),
          fc.array(desiredOutputArbitrary('testnet'), { minLength: 1, maxLength: 5 }),
          intentIdArbitrary,
          fc.boolean(),
          async (inputs, outputs, intentId, payFees) => {
            const result = await connectedAPI.makeIntent(inputs, outputs, { intentId, payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.hasDustSpend).toBe(payFees);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should place intent in correct segment when intentId is numeric', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredInputArbitrary, { minLength: 1, maxLength: 5 }),
          fc.array(desiredOutputArbitrary('testnet'), { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 1, max: 255 }),
          fc.boolean(),
          async (inputs, outputs, segmentId, payFees) => {
            const result = await connectedAPI.makeIntent(inputs, outputs, { intentId: segmentId, payFees });
            const tx = deserializeTransaction(result.tx);

            expect(tx.intents?.has(segmentId)).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should have exact imbalances matching inputs and outputs', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredInputArbitrary, { minLength: 1, maxLength: 5 }),
          fc.array(desiredOutputArbitrary('testnet'), { minLength: 1, maxLength: 5 }),
          intentIdArbitrary,
          fc.boolean(),
          async (inputs, outputs, intentId, payFees) => {
            const result = await connectedAPI.makeIntent(inputs, outputs, { intentId, payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));
            const expectedImbalances = computeExpectedImbalances(inputs, outputs);

            expect(Object.fromEntries(verification.imbalances)).toEqual(Object.fromEntries(expectedImbalances));
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should have correct output counts', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredInputArbitrary, { minLength: 1, maxLength: 5 }),
          fc.array(desiredOutputArbitrary('testnet'), { minLength: 1, maxLength: 5 }),
          intentIdArbitrary,
          fc.boolean(),
          async (inputs, outputs, intentId, payFees) => {
            const shieldedOutputCount = outputs.filter((o) => o.kind === 'shielded').length;
            const unshieldedOutputCount = outputs.filter((o) => o.kind === 'unshielded').length;

            const result = await connectedAPI.makeIntent(inputs, outputs, { intentId, payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(shieldedOutputCount);
            expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(unshieldedOutputCount);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
