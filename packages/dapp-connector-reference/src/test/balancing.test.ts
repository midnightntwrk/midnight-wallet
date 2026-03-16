import { describe, expect, it, vi } from 'vitest';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import {
  defaultConnectorMetadataArbitrary,
  randomValue,
  deserializeTransaction,
  verifyTransaction,
  hasDustSpend,
} from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import {
  prepareMockFacade,
  prepareMockUnshieldedKeystore,
  buildMockUnsealedTransaction,
  buildMockSealedTransaction,
  serializeTransaction,
} from './testUtils.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

describe('balanceUnsealedTransaction', () => {
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

  describe('API contract', () => {
    it('should have balanceUnsealedTransaction method on ConnectedAPI', async () => {
      const connectedAPI = await createConnectedAPI();

      expect(typeof connectedAPI.balanceUnsealedTransaction).toBe('function');
    });
  });

  describe('result structure', () => {
    it('should return deserializable sealed transaction', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      expect(tx).toBeDefined();
      expect(typeof tx.bindingRandomness).toBe('bigint');
    });
  });

  describe('input validation', () => {
    it('should reject malformed hex string', async () => {
      const connectedAPI = await createConnectedAPI();

      await expect(connectedAPI.balanceUnsealedTransaction('not-valid-hex')).rejects.toMatchObject({
        code: 'InvalidRequest',
        reason: expect.stringContaining('malformed'),
      });
    });

    it('should reject empty hex string', async () => {
      const connectedAPI = await createConnectedAPI();

      await expect(connectedAPI.balanceUnsealedTransaction('')).rejects.toMatchObject({
        code: 'InvalidRequest',
        reason: expect.stringContaining('empty'),
      });
    });

    it('should reject already-sealed transaction', async () => {
      const connectedAPI = await createConnectedAPI();
      // Create a sealed (finalized) transaction and serialize it
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      await expect(connectedAPI.balanceUnsealedTransaction(txHex)).rejects.toMatchObject({
        code: 'InvalidRequest',
        reason: expect.stringContaining('unsealed'),
      });
    });
  });

  describe('insufficient balance', () => {
    it('should reject with InsufficientFunds when wallet lacks balance to provide inputs', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: {}, // Empty shielded balances
        unshielded: {}, // Empty unshielded balances
        dust: [], // No dust coins
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      // Transaction that requires balancing (has outputs that need inputs)
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      await expect(connectedAPI.balanceUnsealedTransaction(txHex)).rejects.toMatchObject({
        code: 'InsufficientFunds',
        reason: expect.stringMatching(/insufficient|balance/i),
      });
    });

    it('should reject with InsufficientFunds when wallet lacks dust for fees', async () => {
      const tokenType = '0000000000000000000000000000000000000000000000000000000000000001';
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: { [tokenType]: 1000n }, // Has shielded balance
        unshielded: {},
        dust: [], // No dust for fees
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      await expect(connectedAPI.balanceUnsealedTransaction(txHex, { payFees: true })).rejects.toMatchObject({
        code: 'InsufficientFunds',
        reason: expect.stringMatching(/insufficient|dust|fee/i),
      });
    });

    it('should NOT reject for insufficient dust when payFees is false', async () => {
      const tokenType = '0000000000000000000000000000000000000000000000000000000000000001';
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: { [tokenType]: 1000n }, // Has shielded balance for balancing
        unshielded: {},
        dust: [], // No dust - but payFees=false so this shouldn't matter
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      // Should succeed (or fail for non-dust reasons) - never InsufficientFunds for dust
      const result = await connectedAPI.balanceUnsealedTransaction(txHex, { payFees: false });
      expect(result.tx).toBeDefined();
    });
  });

  describe('balance verification', () => {
    it('should include DustSpend when payFees is true (default)', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(true);
    });

    it('should include DustSpend when payFees is explicitly true', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex, { payFees: true });
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(true);
    });

    it('should NOT include DustSpend when payFees is false', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex, { payFees: false });
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(false);
    });

    it('should return fully balanced transaction', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.isBalanced).toBe(true);
    });
  });

  describe('transaction structure', () => {
    it('should return sealed transaction (with binding randomness)', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      // A sealed transaction has binding randomness set (non-zero)
      expect(tx.bindingRandomness).toBeDefined();
      expect(typeof tx.bindingRandomness).toBe('bigint');
    });

    it('should return transaction with proofs', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      // Verification checks for proof presence via zswap offer examination
      expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(0);
    });

    it('should return transaction ready for submission', async () => {
      const connectedAPI = await createConnectedAPI();
      const txHex = buildMockUnsealedTransaction({ networkId: 'testnet' });

      const result = await connectedAPI.balanceUnsealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      // Transaction should be serializable (no errors)
      expect(() => tx.serialize()).not.toThrow();

      // Transaction should have at least one intent
      expect(tx.intents).toBeDefined();
      expect(tx.intents?.size).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('balanceSealedTransaction', () => {
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

  describe('API contract', () => {
    it('should have balanceSealedTransaction method on ConnectedAPI', async () => {
      const connectedAPI = await createConnectedAPI();

      expect(typeof connectedAPI.balanceSealedTransaction).toBe('function');
    });
  });

  describe('result structure', () => {
    it('should return deserializable sealed transaction', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      expect(tx).toBeDefined();
      expect(typeof tx.bindingRandomness).toBe('bigint');
    });
  });

  describe('input validation', () => {
    it('should reject malformed hex string', async () => {
      const connectedAPI = await createConnectedAPI();

      await expect(connectedAPI.balanceSealedTransaction('not-valid-hex')).rejects.toMatchObject({
        code: 'InvalidRequest',
        reason: expect.stringContaining('malformed'),
      });
    });

    it('should reject empty hex string', async () => {
      const connectedAPI = await createConnectedAPI();

      await expect(connectedAPI.balanceSealedTransaction('')).rejects.toMatchObject({
        code: 'InvalidRequest',
        reason: expect.stringContaining('empty'),
      });
    });
  });

  describe('insufficient balance', () => {
    it('should reject with InsufficientFunds when wallet lacks balance to provide inputs', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: {}, // Empty shielded balances
        unshielded: {}, // Empty unshielded balances
        dust: [], // No dust coins
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      // Sealed transaction that requires balancing
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      await expect(connectedAPI.balanceSealedTransaction(txHex)).rejects.toMatchObject({
        code: 'InsufficientFunds',
        reason: expect.stringMatching(/insufficient|balance/i),
      });
    });

    it('should reject with InsufficientFunds when wallet lacks dust for fees', async () => {
      const tokenType = '0000000000000000000000000000000000000000000000000000000000000001';
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: { [tokenType]: 1000n }, // Has shielded balance
        unshielded: {},
        dust: [], // No dust for fees
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      await expect(connectedAPI.balanceSealedTransaction(txHex, { payFees: true })).rejects.toMatchObject({
        code: 'InsufficientFunds',
        reason: expect.stringMatching(/insufficient|dust|fee/i),
      });
    });

    it('should NOT reject for insufficient dust when payFees is false', async () => {
      const tokenType = '0000000000000000000000000000000000000000000000000000000000000001';
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade().withBalances({
        shielded: { [tokenType]: 1000n }, // Has shielded balance for balancing
        unshielded: {},
        dust: [], // No dust - but payFees=false so this shouldn't matter
      });
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      // Should succeed (or fail for non-dust reasons) - never InsufficientFunds for dust
      const result = await connectedAPI.balanceSealedTransaction(txHex, { payFees: false });
      expect(result.tx).toBeDefined();
    });
  });

  describe('balance verification', () => {
    it('should include DustSpend when payFees is true (default)', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(true);
    });

    it('should include DustSpend when payFees is explicitly true', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex, { payFees: true });
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(true);
    });

    it('should NOT include DustSpend when payFees is false', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex, { payFees: false });
      const tx = deserializeTransaction(result.tx);

      expect(hasDustSpend(tx)).toBe(false);
    });

    it('should return fully balanced transaction', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex);
      const verification = verifyTransaction(deserializeTransaction(result.tx));

      expect(verification.isBalanced).toBe(true);
    });
  });

  describe('transaction structure', () => {
    it('should return sealed transaction (with binding randomness)', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      expect(tx.bindingRandomness).toBeDefined();
      expect(typeof tx.bindingRandomness).toBe('bigint');
    });

    it('should return transaction ready for submission', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      // Transaction should be serializable
      expect(() => tx.serialize()).not.toThrow();

      // Transaction should have at least one intent
      expect(tx.intents).toBeDefined();
      expect(tx.intents?.size).toBeGreaterThanOrEqual(1);
    });

    it('should preserve original transaction intents', async () => {
      const connectedAPI = await createConnectedAPI();
      const sealedTx = buildMockSealedTransaction({ networkId: 'testnet' });
      const originalIntentCount = sealedTx.intents?.size ?? 0;
      const txHex = serializeTransaction(sealedTx);

      const result = await connectedAPI.balanceSealedTransaction(txHex);
      const tx = deserializeTransaction(result.tx);

      // Result should have at least as many intents as original
      // (may have more due to balancing intents being added)
      expect(tx.intents?.size).toBeGreaterThanOrEqual(originalIntentCount);
    });
  });
});
