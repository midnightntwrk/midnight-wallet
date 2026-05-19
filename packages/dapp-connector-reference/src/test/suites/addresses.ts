/**
 * Address retrieval test suite.
 * Tests getShieldedAddresses, getUnshieldedAddress, and getDustAddress.
 */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
  DustAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import type { ConnectedAPITestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

// Valid network ID arbitrary for Bech32m addresses
// Option 1: Well-known network IDs
const wellKnownNetworkIds = fc.constantFrom('testnet', 'devnet', 'qanet', 'preview', 'preprod');

// Option 2: Random valid network IDs - segments joined by dashes
// HRP segment rules: alphanumeric characters (a-z: 97-122, 1-9: 49-57)
// Note: '0' (ASCII 48) is excluded by Bech32m HRP validation
const validHrpChar = fc.oneof(
  fc.integer({ min: 97, max: 122 }).map((code) => String.fromCharCode(code)), // a-z
  fc.integer({ min: 49, max: 57 }).map((code) => String.fromCharCode(code)), // 1-9 (0 excluded)
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

/**
 * Run address retrieval tests against the provided context.
 */
export const runAddressTests = (context: ConnectedAPITestContext): void => {
  describe('getShieldedAddresses', () => {
    it('should return a frozen object with all required fields as valid Bech32m addresses', async () => {
      const { api, disconnect, networkId } = await context.createConnectedAPI();

      try {
        const addresses = await api.getShieldedAddresses();

        expect(Object.isFrozen(addresses)).toBe(true);
        // Decoding validates format, type prefix, and network - throws if invalid
        decodeAddress(addresses.shieldedAddress, ShieldedAddress, networkId);
        decodeAddress(addresses.shieldedCoinPublicKey, ShieldedCoinPublicKey, networkId);
        decodeAddress(addresses.shieldedEncryptionPublicKey, ShieldedEncryptionPublicKey, networkId);
      } finally {
        await disconnect();
      }
    });

    it('should return consistent addresses on multiple calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const addresses1 = await api.getShieldedAddresses();
        const addresses2 = await api.getShieldedAddresses();

        expect(addresses1).toEqual(addresses2);
      } finally {
        await disconnect();
      }
    });

    it('should encode addresses with correct network ID (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(validNetworkIdArbitrary, async (networkId) => {
          const { api, disconnect } = await context.createConnectedAPI({ networkId });

          try {
            const addresses = await api.getShieldedAddresses();

            // Decoding with the expected networkId validates the network is correct
            // If network mismatches, decode throws
            decodeAddress(addresses.shieldedAddress, ShieldedAddress, networkId);
            decodeAddress(addresses.shieldedCoinPublicKey, ShieldedCoinPublicKey, networkId);
            decodeAddress(addresses.shieldedEncryptionPublicKey, ShieldedEncryptionPublicKey, networkId);
          } finally {
            await disconnect();
          }
        }),
        { numRuns: 20 },
      );
    });
  });

  describe('getUnshieldedAddress', () => {
    it('should return a frozen object with valid Bech32m unshieldedAddress', async () => {
      const { api, disconnect, networkId } = await context.createConnectedAPI();

      try {
        const address = await api.getUnshieldedAddress();

        expect(Object.isFrozen(address)).toBe(true);
        decodeAddress(address.unshieldedAddress, UnshieldedAddress, networkId);
      } finally {
        await disconnect();
      }
    });

    it('should return consistent address on multiple calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const address1 = await api.getUnshieldedAddress();
        const address2 = await api.getUnshieldedAddress();

        expect(address1).toEqual(address2);
      } finally {
        await disconnect();
      }
    });

    it('should encode address with correct network ID (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(validNetworkIdArbitrary, async (networkId) => {
          const { api, disconnect } = await context.createConnectedAPI({ networkId });

          try {
            const address = await api.getUnshieldedAddress();

            decodeAddress(address.unshieldedAddress, UnshieldedAddress, networkId);
          } finally {
            await disconnect();
          }
        }),
        { numRuns: 20 },
      );
    });
  });

  describe('getDustAddress', () => {
    it('should return a frozen object with valid Bech32m dustAddress', async () => {
      const { api, disconnect, networkId } = await context.createConnectedAPI();

      try {
        const address = await api.getDustAddress();

        expect(Object.isFrozen(address)).toBe(true);
        decodeAddress(address.dustAddress, DustAddress, networkId);
      } finally {
        await disconnect();
      }
    });

    it('should return consistent address on multiple calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const address1 = await api.getDustAddress();
        const address2 = await api.getDustAddress();

        expect(address1).toEqual(address2);
      } finally {
        await disconnect();
      }
    });

    it('should encode address with correct network ID (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(validNetworkIdArbitrary, async (networkId) => {
          const { api, disconnect } = await context.createConnectedAPI({ networkId });

          try {
            const address = await api.getDustAddress();

            decodeAddress(address.dustAddress, DustAddress, networkId);
          } finally {
            await disconnect();
          }
        }),
        { numRuns: 20 },
      );
    });
  });
};
