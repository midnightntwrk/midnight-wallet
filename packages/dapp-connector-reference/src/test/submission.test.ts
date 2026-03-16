import { describe, it, expect } from 'vitest';
import { Connector } from '../index.js';
import {
  prepareMockFacade,
  prepareMockUnshieldedKeystore,
  buildMockSealedTransaction,
  serializeTransaction,
  testShieldedAddress,
} from './testUtils.js';
import { randomValue, defaultConnectorMetadataArbitrary } from '../testing.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { ErrorCodes } from '../errors.js';
import type { ConnectorConfiguration } from '../types.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

const defaultConfig: ConnectorConfiguration = {
  networkId: 'testnet',
  indexerUri: 'http://localhost:8080',
  indexerWsUri: 'ws://localhost:8080',
  substrateNodeUri: 'ws://localhost:9944',
};

describe('submitTransaction', () => {
  const createConnectedAPI = async (): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const facade = prepareMockFacade();
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, defaultConfig);
    const connectedAPI = await connector.connect('testnet');
    return connectedAPI;
  };

  describe('input validation', () => {
    it('should reject empty transaction hex', async () => {
      const api = await createConnectedAPI();

      await expect(api.submitTransaction('')).rejects.toMatchObject({
        code: ErrorCodes.InvalidRequest,
        message: expect.stringContaining('empty'),
      });
    });

    it('should reject malformed hex', async () => {
      const api = await createConnectedAPI();

      await expect(api.submitTransaction('not-valid-hex!')).rejects.toMatchObject({
        code: ErrorCodes.InvalidRequest,
        message: expect.stringContaining('malformed'),
      });
    });

    it('should reject invalid transaction bytes', async () => {
      const api = await createConnectedAPI();
      // Valid hex but not a valid transaction
      const invalidTxHex = 'deadbeef';

      await expect(api.submitTransaction(invalidTxHex)).rejects.toMatchObject({
        code: ErrorCodes.InvalidRequest,
        message: expect.stringContaining('deserialize'),
      });
    });
  });

  describe('successful submission', () => {
    it('should submit a valid sealed transaction', async () => {
      const api = await createConnectedAPI();
      const tx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(tx);

      // Should resolve without error
      await expect(api.submitTransaction(txHex)).resolves.toBeUndefined();
    });

    it('should accept transaction from makeTransfer', async () => {
      const tokenType = '0000000000000000000000000000000000000000000000000000000000000000';
      const shieldedAddress = MidnightBech32m.encode('testnet', testShieldedAddress).asString();
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: { [tokenType]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const api = await connector.connect('testnet');

      // Create a transfer transaction
      const { tx } = await api.makeTransfer([
        {
          kind: 'shielded',
          type: tokenType,
          value: 100n,
          recipient: shieldedAddress,
        },
      ]);

      // Submit the transaction from makeTransfer
      await expect(api.submitTransaction(tx)).resolves.toBeUndefined();
    });

    it('should accept transaction from balanceSealedTransaction', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const api = await connector.connect('testnet');

      // Create a sealed transaction and balance it
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const { tx } = await api.balanceSealedTransaction(serializeTransaction(sealedTx));

      // Submit the balanced transaction
      await expect(api.submitTransaction(tx)).resolves.toBeUndefined();
    });
  });

  describe('disconnection', () => {
    it('should reject when disconnected', async () => {
      const api = await createConnectedAPI();
      await api.disconnect();

      const tx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(tx);

      await expect(api.submitTransaction(txHex)).rejects.toMatchObject({
        code: ErrorCodes.Disconnected,
      });
    });
  });

  describe('submission errors', () => {
    it('should propagate submission errors from facade', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withSubmissionError(new Error('Network unavailable'));
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const api = await connector.connect('testnet');

      const tx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(tx);

      await expect(api.submitTransaction(txHex)).rejects.toThrow('Network unavailable');
    });
  });
});
