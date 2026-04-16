/**
 * Input validation test suite.
 * Tests validation of makeTransfer and makeIntent inputs.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import type { ConnectedAPITestContext } from '../context.js';
import { testShieldedAddress, testUnshieldedAddress } from '../testUtils.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

// Valid test data
const validTokenType = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Run input validation tests against the provided context.
 */
export const runValidationTests = (context: ConnectedAPITestContext): void => {
  // Bech32m encoded addresses for API calls
  const shieldedAddress = MidnightBech32m.encode('testnet', testShieldedAddress).asString();
  const unshieldedAddress = MidnightBech32m.encode('testnet', testUnshieldedAddress).asString();

  describe('makeTransfer validation', () => {
    describe('empty outputs', () => {
      it('should reject empty outputs array', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.makeTransfer([])).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('At least one output is required'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('token type validation', () => {
      it('should reject token type that is too short', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: '00000000', value: 100n, recipient: shieldedAddress },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('64 hex characters'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject token type that is too long', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType + 'aa', value: 100n, recipient: shieldedAddress },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('64 hex characters'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject token type with invalid hex characters', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            {
              kind: 'shielded',
              type: 'gg00000000000000000000000000000000000000000000000000000000000000',
              value: 100n,
              recipient: shieldedAddress,
            },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('valid hex string'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('amount validation', () => {
      it('should reject zero amount', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType, value: 0n, recipient: shieldedAddress },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('must be positive'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject negative amount', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType, value: -100n, recipient: shieldedAddress },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('must be positive'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('address validation', () => {
      it('should reject empty address', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType, value: 100n, recipient: '' },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('non-empty string'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject invalid Bech32m address', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType, value: 100n, recipient: 'invalid-address' },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('invalid Bech32m'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject unshielded address for shielded output', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType, value: 100n, recipient: unshieldedAddress },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('expected shielded address'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject shielded address for unshielded output', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'unshielded', type: validTokenType, value: 100n, recipient: shieldedAddress },
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('expected unshielded address'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('multiple outputs validation', () => {
      it('should report error for first invalid output', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType, value: 100n, recipient: shieldedAddress }, // valid
            { kind: 'shielded', type: 'short', value: 100n, recipient: shieldedAddress }, // invalid
          ];

          await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('outputs[1].type'),
          });
        } finally {
          await disconnect();
        }
      });
    });
  });

  describe('makeIntent validation', () => {
    describe('empty inputs and outputs', () => {
      it('should reject when both inputs and outputs are empty', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.makeIntent([], [], { intentId: 'random', payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('At least one input or output is required'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('input validation', () => {
      it('should reject input with invalid token type', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const inputs: DesiredInput[] = [{ kind: 'shielded', type: 'invalid', value: 100n }];

          await expect(api.makeIntent(inputs, [], { intentId: 'random', payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('inputs[0].type'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject input with zero amount', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 0n }];

          await expect(api.makeIntent(inputs, [], { intentId: 'random', payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('inputs[0].value'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('intentId validation', () => {
      it('should reject negative intentId', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

          await expect(api.makeIntent(inputs, [], { intentId: -1, payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('intentId must be an integer between 1 and 65535'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject intentId greater than 65535', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

          await expect(api.makeIntent(inputs, [], { intentId: 65536, payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('intentId must be an integer between 1 and 65535'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject non-integer intentId', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

          await expect(api.makeIntent(inputs, [], { intentId: 1.5, payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('intentId must be an integer between 1 and 65535'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject intentId of 0 (segment 0 is reserved)', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const inputs: DesiredInput[] = [{ kind: 'shielded', type: validTokenType, value: 100n }];

          await expect(api.makeIntent(inputs, [], { intentId: 0, payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('segment 0 is reserved'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('output validation in intent', () => {
      it('should reject output with mismatched address type', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          const outputs: DesiredOutput[] = [
            { kind: 'shielded', type: validTokenType, value: 100n, recipient: unshieldedAddress },
          ];

          await expect(api.makeIntent([], outputs, { intentId: 'random', payFees: false })).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('expected shielded address'),
          });
        } finally {
          await disconnect();
        }
      });
    });
  });

  describe('error message quality', () => {
    it('should include field path in error message', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: 100n, recipient: shieldedAddress },
          { kind: 'unshielded', type: 'bad', value: 100n, recipient: unshieldedAddress },
        ];

        await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
          reason: expect.stringMatching(/outputs\[1\]\.type/),
        });
      } finally {
        await disconnect();
      }
    });

    it('should include actual value in amount error', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: validTokenType, value: -42n, recipient: shieldedAddress },
        ];

        await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
          reason: expect.stringContaining('-42'),
        });
      } finally {
        await disconnect();
      }
    });

    it('should include actual length in token type error', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: '00000000', value: 100n, recipient: shieldedAddress },
        ];

        await expect(api.makeTransfer(outputs)).rejects.toMatchObject({
          reason: expect.stringContaining('got 8'),
        });
      } finally {
        await disconnect();
      }
    });
  });
};
