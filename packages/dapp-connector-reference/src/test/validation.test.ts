import { describe, expect, it, vi } from 'vitest';
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore, testShieldedAddress, testUnshieldedAddress } from './testUtils.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

describe('Input Validation', () => {
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

  // Valid test data
  const shieldedAddress = MidnightBech32m.encode('testnet', testShieldedAddress).asString();
  const unshieldedAddress = MidnightBech32m.encode('testnet', testUnshieldedAddress).asString();
  const validTokenType = '0000000000000000000000000000000000000000000000000000000000000000';

  describe('makeTransfer validation', () => {
    describe('empty outputs', () => {
      it('should reject empty outputs array', async () => {
        const connectedAPI = await createConnectedAPI();

        await expect(connectedAPI.makeTransfer([])).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('At least one output is required'),
        });
      });
    });

    describe('token type validation', () => {
      it('should reject token type that is too short', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: '00000000', value: 100n, recipient: shieldedAddress },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('64 hex characters'),
        });
      });

      it('should reject token type that is too long', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType + 'aa', value: 100n, recipient: shieldedAddress },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('64 hex characters'),
        });
      });

      it('should reject token type with invalid hex characters', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: 'gg00000000000000000000000000000000000000000000000000000000000000', value: 100n, recipient: shieldedAddress },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('valid hex string'),
        });
      });
    });

    describe('amount validation', () => {
      it('should reject zero amount', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 0n, recipient: shieldedAddress },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('must be positive'),
        });
      });

      it('should reject negative amount', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: -100n, recipient: shieldedAddress },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('must be positive'),
        });
      });
    });

    describe('address validation', () => {
      it('should reject empty address', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 100n, recipient: '' },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('non-empty string'),
        });
      });

      it('should reject invalid Bech32m address', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 100n, recipient: 'invalid-address' },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('invalid Bech32m'),
        });
      });

      it('should reject unshielded address for shielded output', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 100n, recipient: unshieldedAddress },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('expected shielded address'),
        });
      });

      it('should reject shielded address for unshielded output', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'unshielded', type: validTokenType, value: 100n, recipient: shieldedAddress },
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('expected unshielded address'),
        });
      });
    });

    describe('multiple outputs validation', () => {
      it('should report error for first invalid output', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 100n, recipient: shieldedAddress }, // valid
          { kind: 'shielded', type: 'short', value: 100n, recipient: shieldedAddress }, // invalid
        ];

        await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('outputs[1].type'),
        });
      });
    });
  });

  describe('makeIntent validation', () => {
    describe('empty inputs and outputs', () => {
      it('should reject when both inputs and outputs are empty', async () => {
        const connectedAPI = await createConnectedAPI();

        await expect(
          connectedAPI.makeIntent([], [], { intentId: 'random', payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('At least one input or output is required'),
        });
      });

      it('should accept when only inputs are provided', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

        // Should not throw - may fail later in transaction building but validation passes
        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 'random', payFees: false }),
        ).resolves.toBeDefined();
      });

      it('should accept when only outputs are provided', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 100n, recipient: shieldedAddress },
        ];

        // Should not throw - may fail later in transaction building but validation passes
        await expect(
          connectedAPI.makeIntent([], outputs, { intentId: 'random', payFees: false }),
        ).resolves.toBeDefined();
      });
    });

    describe('input validation', () => {
      it('should reject input with invalid token type', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: 'invalid', value: 100n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 'random', payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('inputs[0].type'),
        });
      });

      it('should reject input with zero amount', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 0n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 'random', payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('inputs[0].value'),
        });
      });
    });

    describe('intentId validation', () => {
      it('should reject negative intentId', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: -1, payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('intentId must be an integer between 1 and 65535'),
        });
      });

      it('should reject intentId greater than 65535', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 65536, payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('intentId must be an integer between 1 and 65535'),
        });
      });

      it('should reject non-integer intentId', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 1.5, payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('intentId must be an integer between 1 and 65535'),
        });
      });

      it('should reject intentId of 0 (segment 0 is reserved)', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 0, payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('segment 0 is reserved'),
        });
      });

      it('should accept intentId of 65535', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 65535, payFees: false }),
        ).resolves.toBeDefined();
      });

      it('should accept "random" as intentId', async () => {
        const connectedAPI = await createConnectedAPI();
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

        await expect(
          connectedAPI.makeIntent(inputs, [], { intentId: 'random', payFees: false }),
        ).resolves.toBeDefined();
      });
    });

    describe('output validation in intent', () => {
      it('should reject output with mismatched address type', async () => {
        const connectedAPI = await createConnectedAPI();
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 100n, recipient: unshieldedAddress },
        ];

        await expect(
          connectedAPI.makeIntent([], outputs, { intentId: 'random', payFees: false }),
        ).rejects.toMatchObject({
          code: 'InvalidRequest',
          reason: expect.stringContaining('expected shielded address'),
        });
      });
    });
  });

  describe('error message quality', () => {
    it('should include field path in error message', async () => {
      const connectedAPI = await createConnectedAPI();
      const outputs: DesiredOutput[] = [
        { kind: 'shielded', type: validTokenType, value: 100n, recipient: shieldedAddress },
        { kind: 'unshielded', type: 'bad', value: 100n, recipient: unshieldedAddress },
      ];

      await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
        reason: expect.stringMatching(/outputs\[1\]\.type/),
      });
    });

    it('should include actual value in amount error', async () => {
      const connectedAPI = await createConnectedAPI();
      const outputs: DesiredOutput[] = [
        { kind: 'shielded', type: validTokenType, value: -42n, recipient: shieldedAddress },
      ];

      await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
        reason: expect.stringContaining('-42'),
      });
    });

    it('should include actual length in token type error', async () => {
      const connectedAPI = await createConnectedAPI();
      const outputs: DesiredOutput[] = [
        { kind: 'shielded', type: '00000000', value: 100n, recipient: shieldedAddress },
      ];

      await expect(connectedAPI.makeTransfer(outputs)).rejects.toMatchObject({
        reason: expect.stringContaining('got 8'),
      });
    });
  });
});
