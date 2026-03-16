import { describe, it, expect } from 'vitest';
import { Connector } from '../index.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
import { randomValue, defaultConnectorMetadataArbitrary } from '../testing.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { ErrorCodes } from '../errors.js';
import type { ConnectorConfiguration } from '../types.js';

const defaultConfig: ConnectorConfiguration = {
  networkId: 'testnet',
  indexerUri: 'http://localhost:8080',
  indexerWsUri: 'ws://localhost:8080',
  substrateNodeUri: 'ws://localhost:9944',
};

describe('signData', () => {
  const createConnectedAPI = async (): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const facade = prepareMockFacade();
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, defaultConfig);
    const connectedAPI = await connector.connect('testnet');
    return connectedAPI;
  };

  describe('encoding: hex', () => {
    it('should sign hex-encoded data', async () => {
      const api = await createConnectedAPI();
      const hexData = 'deadbeef';

      const result = await api.signData(hexData, { encoding: 'hex', keyType: 'unshielded' });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('verifyingKey');
    });

    it('should include prefix in signed data', async () => {
      const api = await createConnectedAPI();
      const hexData = 'deadbeef';

      const result = await api.signData(hexData, { encoding: 'hex', keyType: 'unshielded' });

      // The prefix format is: midnight_signed_message:<size>:
      // For 'deadbeef' (4 bytes), prefix should be 'midnight_signed_message:4:'
      expect(result.data).toMatch(/^midnight_signed_message:\d+:/);
    });

    it('should reject invalid hex', async () => {
      const api = await createConnectedAPI();

      await expect(api.signData('not-valid-hex!', { encoding: 'hex', keyType: 'unshielded' })).rejects.toMatchObject({
        code: ErrorCodes.InvalidRequest,
        message: expect.stringContaining('hex'),
      });
    });

    it('should accept empty hex string', async () => {
      const api = await createConnectedAPI();

      const result = await api.signData('', { encoding: 'hex', keyType: 'unshielded' });

      expect(result.data).toMatch(/^midnight_signed_message:0:/);
    });
  });

  describe('encoding: base64', () => {
    it('should sign base64-encoded data', async () => {
      const api = await createConnectedAPI();
      const base64Data = Buffer.from('hello world').toString('base64');

      const result = await api.signData(base64Data, { encoding: 'base64', keyType: 'unshielded' });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('verifyingKey');
    });

    it('should include correct size in prefix for base64', async () => {
      const api = await createConnectedAPI();
      const originalData = 'hello world'; // 11 bytes
      const base64Data = Buffer.from(originalData).toString('base64');

      const result = await api.signData(base64Data, { encoding: 'base64', keyType: 'unshielded' });

      expect(result.data).toMatch(/^midnight_signed_message:11:/);
    });

    it('should reject invalid base64', async () => {
      const api = await createConnectedAPI();

      await expect(api.signData('!!!invalid!!!', { encoding: 'base64', keyType: 'unshielded' })).rejects.toMatchObject({
        code: ErrorCodes.InvalidRequest,
        message: expect.stringContaining('base64'),
      });
    });
  });

  describe('encoding: text', () => {
    it('should sign text data as UTF-8', async () => {
      const api = await createConnectedAPI();
      const textData = 'hello world';

      const result = await api.signData(textData, { encoding: 'text', keyType: 'unshielded' });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('verifyingKey');
    });

    it('should include correct size in prefix for text', async () => {
      const api = await createConnectedAPI();
      const textData = 'hello'; // 5 bytes in UTF-8

      const result = await api.signData(textData, { encoding: 'text', keyType: 'unshielded' });

      expect(result.data).toMatch(/^midnight_signed_message:5:/);
    });

    it('should handle UTF-8 multi-byte characters', async () => {
      const api = await createConnectedAPI();
      const textData = '你好'; // 6 bytes in UTF-8 (3 bytes per character)

      const result = await api.signData(textData, { encoding: 'text', keyType: 'unshielded' });

      expect(result.data).toMatch(/^midnight_signed_message:6:/);
    });

    it('should handle empty text', async () => {
      const api = await createConnectedAPI();

      const result = await api.signData('', { encoding: 'text', keyType: 'unshielded' });

      expect(result.data).toMatch(/^midnight_signed_message:0:/);
    });
  });

  describe('signature verification', () => {
    it('should return a valid hex signature', async () => {
      const api = await createConnectedAPI();

      const result = await api.signData('test', { encoding: 'text', keyType: 'unshielded' });

      // Signature should be hex-encoded
      expect(result.signature).toMatch(/^[0-9a-f]+$/i);
    });

    it('should return a valid hex verifying key', async () => {
      const api = await createConnectedAPI();

      const result = await api.signData('test', { encoding: 'text', keyType: 'unshielded' });

      // Verifying key should be hex-encoded
      expect(result.verifyingKey).toMatch(/^[0-9a-f]+$/i);
    });

    it('should return consistent verifying key across calls', async () => {
      const api = await createConnectedAPI();

      const result1 = await api.signData('test1', { encoding: 'text', keyType: 'unshielded' });
      const result2 = await api.signData('test2', { encoding: 'text', keyType: 'unshielded' });

      expect(result1.verifyingKey).toBe(result2.verifyingKey);
    });
  });

  describe('disconnection', () => {
    it('should reject when disconnected', async () => {
      const api = await createConnectedAPI();
      await api.disconnect();

      await expect(api.signData('test', { encoding: 'text', keyType: 'unshielded' })).rejects.toMatchObject({
        code: ErrorCodes.Disconnected,
      });
    });
  });
});
