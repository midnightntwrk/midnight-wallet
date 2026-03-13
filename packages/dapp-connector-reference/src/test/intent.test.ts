import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import {
  defaultConnectorMetadataArbitrary,
  randomValue,
  desiredInputArbitrary,
  desiredOutputArbitrary,
  deserializeTransaction,
  verifyTransaction,
  hasDustSpend,
  testShieldedWithKeys,
  testUnshieldedWithKeys,
} from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
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

  // Test addresses with retained secret keys for output verification
  // These enable decryption-based verification for shielded outputs
  // and exact recipient matching for unshielded outputs
  const shieldedRecipient = testShieldedWithKeys;
  const unshieldedRecipient = testUnshieldedWithKeys;

  // Bech32m encoded addresses for API calls
  const shieldedAddress = MidnightBech32m.encode('testnet', shieldedRecipient.address).asString();
  const unshieldedAddress = MidnightBech32m.encode('testnet', unshieldedRecipient.address).asString();

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
    it('should create swap with shielded input and unshielded output', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: anotherTokenType, value: 50n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.imbalances).toEqual({
        shielded: { [tokenType]: -100n },
        unshielded: { [anotherTokenType]: 50n },
      });

      expect(
        verification.containsUnshieldedOutputs([
          { owner: unshieldedRecipient.verifyingKey, tokenType: anotherTokenType, value: 50n },
        ]),
      ).toBe(true);

      expect(verification.hasDustSpend).toBe(true);
    });

    it('should create swap with unshielded input and shielded output', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'unshielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: anotherTokenType, value: 50n, recipient: shieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.imbalances).toEqual({
        shielded: { [anotherTokenType]: 50n },
        unshielded: { [tokenType]: -100n },
      });

      expect(
        verification.containsShieldedOutputs(shieldedRecipient.secretKeys, [
          { tokenType: anotherTokenType, value: 50n },
        ]),
      ).toBe(true);

      expect(verification.hasDustSpend).toBe(true);
    });

    it('should create balanced swap with multiple inputs and outputs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [
        { kind: 'shielded', type: tokenType, value: 100n },
        { kind: 'unshielded', type: anotherTokenType, value: 50n },
      ];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'shielded', type: tokenType, value: 100n, recipient: shieldedAddress },
        { kind: 'unshielded', type: anotherTokenType, value: 50n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.isBalanced).toBe(true);

      expect(
        verification.containsOutputs({
          shielded: {
            secretKeys: shieldedRecipient.secretKeys,
            outputs: [{ tokenType: tokenType, value: 100n }],
          },
          unshielded: [{ owner: unshieldedRecipient.verifyingKey, tokenType: anotherTokenType, value: 50n }],
        }),
      ).toBe(true);
    });
  });

  describe('intentId option', () => {
    it('should accept intentId as "random" and place in non-zero segment', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: 100n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx.intents).toBeDefined();
      expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
      expect(tx.intents!.has(0)).toBe(false);
      const segmentIds = Array.from(tx.intents!.keys());
      expect(segmentIds.every((id) => id >= 1 && id <= 65535)).toBe(true);
    });

    it('should place intent in exact segment when intentId is 1', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: 100n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 1,
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx.intents).toBeDefined();
      expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
      expect(tx.intents!.has(1)).toBe(true);
      expect(tx.intents!.has(0)).toBe(false);
    });

    it('should place intent in exact segment when intentId is arbitrary value', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: 100n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 42,
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(tx.intents).toBeDefined();
      expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
      expect(tx.intents!.has(42)).toBe(true);
      expect(tx.intents!.has(0)).toBe(false);
    });
  });

  describe('payFees option', () => {
    it('should include DustSpend when payFees is true', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: 100n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });

      const tx = deserializeTransaction(result.tx);
      expect(hasDustSpend(tx)).toBe(true);
    });

    it('should NOT include DustSpend when payFees is false', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: tokenType, value: 100n, recipient: unshieldedAddress },
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

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.imbalances).toEqual({
        shielded: { [tokenType]: -100n },
        unshielded: { [anotherTokenType]: 50n },
      });
    });

    it('should have exact imbalances for shielded inputs', async () => {
      const connectedAPI = await createConnectedAPI();

      const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenType, value: 100n }];
      const desiredOutputs: DesiredOutput[] = [
        { kind: 'unshielded', type: anotherTokenType, value: 75n, recipient: unshieldedAddress },
      ];

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.imbalances).toEqual({
        shielded: { [tokenType]: -100n },
        unshielded: { [anotherTokenType]: 75n },
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

      const result = await connectedAPI.makeIntent(desiredInputs, desiredOutputs, {
        intentId: 'random',
        payFees: true,
      });
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.imbalances).toEqual({
        shielded: { [tokenType]: -150n },
        unshielded: { [anotherTokenType]: 100n },
      });
    });
  });

  describe('property-based tests', () => {
    const intentIdArbitrary = fc.oneof(fc.constant('random' as const), fc.integer({ min: 1, max: 65535 }));

    // Combined arbitrary for inputs and outputs that enforces the API precondition:
    // count(inputs) + count(outputs) > 0
    const inputsOutputsArbitrary = fc
      .tuple(fc.array(desiredInputArbitrary), fc.array(desiredOutputArbitrary('testnet')))
      .filter(([inputs, outputs]) => inputs.length + outputs.length > 0);

    it('should have DustSpend iff payFees is true', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          inputsOutputsArbitrary,
          intentIdArbitrary,
          fc.boolean(),
          async ([inputs, outputs], intentId, payFees) => {
            const result = await connectedAPI.makeIntent(inputs, outputs, { intentId, payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.hasDustSpend).toBe(payFees);
          },
        ),
        { numRuns: 25 },
      );
    }, 60_000);

    it('should place intent in exact segment specified by numeric intentId', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          inputsOutputsArbitrary,
          fc.integer({ min: 1, max: 65535 }),
          fc.boolean(),
          async ([inputs, outputs], segmentId, payFees) => {
            const result = await connectedAPI.makeIntent(inputs, outputs, { intentId: segmentId, payFees });
            const tx = deserializeTransaction(result.tx);

            expect(tx.intents).toBeDefined();
            expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
            expect(tx.intents!.has(segmentId)).toBe(true);
          },
        ),
        { numRuns: 25 },
      );
    }, 60_000);

    it('should have correct output counts', async () => {
      const connectedAPI = await createConnectedAPI();

      await fc.assert(
        fc.asyncProperty(
          inputsOutputsArbitrary,
          intentIdArbitrary,
          fc.boolean(),
          async ([inputs, outputs], intentId, payFees) => {
            const shieldedOutputCount = outputs.filter((o) => o.kind === 'shielded').length;
            const unshieldedOutputCount = outputs.filter((o) => o.kind === 'unshielded').length;

            const result = await connectedAPI.makeIntent(inputs, outputs, { intentId, payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(shieldedOutputCount);
            expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(unshieldedOutputCount);
          },
        ),
        { numRuns: 25 },
      );
    }, 60_000);
  });
});
