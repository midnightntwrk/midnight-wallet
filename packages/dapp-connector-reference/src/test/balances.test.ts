import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

// Token type arbitrary - uses ledger's sampleRawTokenType for realistic 32-byte hex strings
const tokenTypeArbitrary = fc.constant(null).map(() => ledger.sampleRawTokenType());

// Balance value arbitrary - non-negative bigint, unbounded
const balanceValueArbitrary = fc.bigInt({ min: 0n });

// Balances record arbitrary - can be empty or have many entries
const balancesArbitrary = fc.dictionary(tokenTypeArbitrary, balanceValueArbitrary);

describe('Balance Methods', () => {
  const defaultConfig: ConnectorConfiguration = {
    networkId: 'testnet',
    indexerUri: 'http://localhost:8080',
    indexerWsUri: 'ws://localhost:8080',
    substrateNodeUri: 'ws://localhost:9944',
  };

  const createConnectedAPI = async (
    facade: ReturnType<typeof prepareMockFacade> = prepareMockFacade(),
  ): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, defaultConfig);
    return connector.connect('testnet');
  };

  describe('getShieldedBalances', () => {
    it('should return a frozen Record with string keys and bigint values', async () => {
      const connectedAPI = await createConnectedAPI();

      const balances = await connectedAPI.getShieldedBalances();

      expect(typeof balances).toBe('object');
      expect(balances).not.toBeNull();
      expect(Object.isFrozen(balances)).toBe(true);
      for (const key of Object.keys(balances)) {
        expect(typeof key).toBe('string');
      }
      for (const value of Object.values(balances)) {
        expect(typeof value).toBe('bigint');
        expect(value).toBeGreaterThanOrEqual(0n);
      }
    });

    it('should return balances matching facade state (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(balancesArbitrary, async (expectedBalances) => {
          const facade = prepareMockFacade().withBalances({ shielded: expectedBalances });
          const connectedAPI = await createConnectedAPI(facade);

          const balances = await connectedAPI.getShieldedBalances();

          expect(balances).toEqual(expectedBalances);
        }),
        { numRuns: 20 },
      );
    });
  });

  describe('getUnshieldedBalances', () => {
    it('should return a frozen Record with string keys and bigint values', async () => {
      const connectedAPI = await createConnectedAPI();

      const balances = await connectedAPI.getUnshieldedBalances();

      expect(typeof balances).toBe('object');
      expect(balances).not.toBeNull();
      expect(Object.isFrozen(balances)).toBe(true);
      for (const key of Object.keys(balances)) {
        expect(typeof key).toBe('string');
      }
      for (const value of Object.values(balances)) {
        expect(typeof value).toBe('bigint');
        expect(value).toBeGreaterThanOrEqual(0n);
      }
    });

    it('should return balances matching facade state (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(balancesArbitrary, async (expectedBalances) => {
          const facade = prepareMockFacade().withBalances({ unshielded: expectedBalances });
          const connectedAPI = await createConnectedAPI(facade);

          const balances = await connectedAPI.getUnshieldedBalances();

          expect(balances).toEqual(expectedBalances);
        }),
        { numRuns: 20 },
      );
    });
  });

  describe('getDustBalance', () => {
    it('should return a frozen object with cap and balance as bigints', async () => {
      const connectedAPI = await createConnectedAPI();

      const dustBalance = await connectedAPI.getDustBalance();

      expect(dustBalance).toHaveProperty('cap');
      expect(dustBalance).toHaveProperty('balance');
      expect(typeof dustBalance.cap).toBe('bigint');
      expect(typeof dustBalance.balance).toBe('bigint');
      expect(Object.isFrozen(dustBalance)).toBe(true);
    });

    it('should return non-negative values with balance <= cap', async () => {
      const connectedAPI = await createConnectedAPI();

      const dustBalance = await connectedAPI.getDustBalance();

      expect(dustBalance.cap).toBeGreaterThanOrEqual(0n);
      expect(dustBalance.balance).toBeGreaterThanOrEqual(0n);
      expect(dustBalance.balance).toBeLessThanOrEqual(dustBalance.cap);
    });

    it('should return dust balance matching facade state (property-based)', async () => {
      // Each coin has maxCap and balance where balance <= maxCap
      const dustCoinArbitrary = fc
        .record({
          maxCap: balanceValueArbitrary,
          balance: balanceValueArbitrary,
        })
        .filter(({ maxCap, balance }) => balance <= maxCap);

      // Array of coins (can be empty or have multiple)
      const dustCoinsArbitrary = fc.array(dustCoinArbitrary, { minLength: 0, maxLength: 5 });

      await fc.assert(
        fc.asyncProperty(dustCoinsArbitrary, async (coins) => {
          const facade = prepareMockFacade().withBalances({ dust: coins });
          const connectedAPI = await createConnectedAPI(facade);

          const dustBalance = await connectedAPI.getDustBalance();

          const expectedCap = coins.reduce((sum, coin) => sum + coin.maxCap, 0n);
          const expectedBalance = coins.reduce((sum, coin) => sum + coin.balance, 0n);
          expect(dustBalance.cap).toBe(expectedCap);
          expect(dustBalance.balance).toBe(expectedBalance);
        }),
        { numRuns: 20 },
      );
    });
  });
});
