import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import {
  prepareMockFacade,
  prepareMockUnshieldedKeystore,
  testShieldedAddress,
  testShieldedCoinPublicKey,
  testShieldedEncryptionPublicKey,
  testUnshieldedAddress,
  testDustAddress,
} from './testUtils.js';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
  DustAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

// Valid network ID arbitrary for Bech32m addresses
// Option 1: Well-known network IDs
const wellKnownNetworkIds = fc.constantFrom('testnet', 'devnet', 'qanet', 'preview', 'preprod');

// Option 2: Random valid network IDs - segments joined by dashes
// HRP segment rules: alphanumeric characters (a-z: 97-122, 0-9: 48-57)
const validHrpChar = fc.oneof(
  fc.integer({ min: 97, max: 122 }).map((code) => String.fromCharCode(code)), // a-z
  fc.integer({ min: 48, max: 57 }).map((code) => String.fromCharCode(code)), // 0-9
);
const validNetworkIdSegment = fc.array(validHrpChar, { minLength: 1, maxLength: 8 }).map((chars) => chars.join(''));
const randomNetworkId = fc
  .array(validNetworkIdSegment, { minLength: 1, maxLength: 5 })
  .map((segments) => segments.join('-'));

const validNetworkIdArbitrary: fc.Arbitrary<string> = fc.oneof(wellKnownNetworkIds, randomNetworkId);

// Helper to decode address string - throws if invalid format, type, or network mismatch
const decodeAddress = <T>(
  bech32m: string,
  addressClass: { codec: { decode: (networkId: string, repr: MidnightBech32m) => T } },
  networkId: string,
): T => {
  const parsed = MidnightBech32m.parse(bech32m);
  return addressClass.codec.decode(networkId, parsed);
};

describe('Address Methods', () => {
  const defaultConfig: ConnectorConfiguration = {
    networkId: 'testnet',
    indexerUri: 'http://localhost:8080',
    indexerWsUri: 'ws://localhost:8080',
    substrateNodeUri: 'ws://localhost:9944',
  };

  const createConnectedAPI = async (config = defaultConfig): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const facade = prepareMockFacade();
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, config);
    return connector.connect(config.networkId);
  };

  describe('getShieldedAddresses', () => {
    it('should return a frozen object with all required fields as valid Bech32m addresses', async () => {
      const connectedAPI = await createConnectedAPI();

      const addresses = await connectedAPI.getShieldedAddresses();

      expect(Object.isFrozen(addresses)).toBe(true);
      // Decoding validates format, type prefix, and network - throws if invalid
      expect(decodeAddress(addresses.shieldedAddress, ShieldedAddress, 'testnet').equals(testShieldedAddress)).toBe(
        true,
      );
      expect(
        decodeAddress(addresses.shieldedCoinPublicKey, ShieldedCoinPublicKey, 'testnet').equals(
          testShieldedCoinPublicKey,
        ),
      ).toBe(true);
      expect(
        decodeAddress(addresses.shieldedEncryptionPublicKey, ShieldedEncryptionPublicKey, 'testnet').equals(
          testShieldedEncryptionPublicKey,
        ),
      ).toBe(true);
    });

    it('should return consistent addresses on multiple calls', async () => {
      const connectedAPI = await createConnectedAPI();

      const addresses1 = await connectedAPI.getShieldedAddresses();
      const addresses2 = await connectedAPI.getShieldedAddresses();

      expect(addresses1).toEqual(addresses2);
    });

    it('should encode addresses with correct network ID (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(validNetworkIdArbitrary, async (networkId) => {
          const config: ConnectorConfiguration = { ...defaultConfig, networkId };
          const connectedAPI = await createConnectedAPI(config);

          const addresses = await connectedAPI.getShieldedAddresses();

          // Decoding with the expected networkId validates the network is correct
          // If network mismatches, decode throws
          decodeAddress(addresses.shieldedAddress, ShieldedAddress, networkId);
          decodeAddress(addresses.shieldedCoinPublicKey, ShieldedCoinPublicKey, networkId);
          decodeAddress(addresses.shieldedEncryptionPublicKey, ShieldedEncryptionPublicKey, networkId);
        }),
        { numRuns: 20 },
      );
    });
  });

  describe('getUnshieldedAddress', () => {
    it('should return a frozen object with valid Bech32m unshieldedAddress', async () => {
      const connectedAPI = await createConnectedAPI();

      const address = await connectedAPI.getUnshieldedAddress();

      expect(Object.isFrozen(address)).toBe(true);
      expect(decodeAddress(address.unshieldedAddress, UnshieldedAddress, 'testnet').equals(testUnshieldedAddress)).toBe(
        true,
      );
    });

    it('should return consistent address on multiple calls', async () => {
      const connectedAPI = await createConnectedAPI();

      const address1 = await connectedAPI.getUnshieldedAddress();
      const address2 = await connectedAPI.getUnshieldedAddress();

      expect(address1).toEqual(address2);
    });

    it('should encode address with correct network ID (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(validNetworkIdArbitrary, async (networkId) => {
          const config: ConnectorConfiguration = { ...defaultConfig, networkId };
          const connectedAPI = await createConnectedAPI(config);

          const address = await connectedAPI.getUnshieldedAddress();

          decodeAddress(address.unshieldedAddress, UnshieldedAddress, networkId);
        }),
        { numRuns: 20 },
      );
    });
  });

  describe('getDustAddress', () => {
    it('should return a frozen object with valid Bech32m dustAddress', async () => {
      const connectedAPI = await createConnectedAPI();

      const address = await connectedAPI.getDustAddress();

      expect(Object.isFrozen(address)).toBe(true);
      expect(decodeAddress(address.dustAddress, DustAddress, 'testnet').equals(testDustAddress)).toBe(true);
    });

    it('should return consistent address on multiple calls', async () => {
      const connectedAPI = await createConnectedAPI();

      const address1 = await connectedAPI.getDustAddress();
      const address2 = await connectedAPI.getDustAddress();

      expect(address1).toEqual(address2);
    });

    it('should encode address with correct network ID (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(validNetworkIdArbitrary, async (networkId) => {
          const config: ConnectorConfiguration = { ...defaultConfig, networkId };
          const connectedAPI = await createConnectedAPI(config);

          const address = await connectedAPI.getDustAddress();

          decodeAddress(address.dustAddress, DustAddress, networkId);
        }),
        { numRuns: 20 },
      );
    });
  });
});
