import { describe, it, expect } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { makeDefaultKeysCapability } from '../Keys.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { CoreWallet } from '../CoreWallet.js';
import * as fc from 'fast-check';

const seedArbitrary = fc.uint8Array({ minLength: 32, maxLength: 32 });
const differentSeedsArbitrary = fc
  .uniqueArray(seedArbitrary, { minLength: 2, maxLength: 2 })
  .map(([seed1, seed2]) => [seed1, seed2]);

describe('DefaultKeysCapability', () => {
  describe('when generating keys and addresses', () => {
    it('should generate consistent coin public keys for any seed', () => {
      fc.assert(
        fc.property(seedArbitrary, (seed) => {
          const networkId = NetworkId.NetworkId.Undeployed;
          const state1 = CoreWallet.initEmpty(ledger.ZswapSecretKeys.fromSeed(seed), networkId);
          const state2 = CoreWallet.initEmpty(ledger.ZswapSecretKeys.fromSeed(seed), networkId);
          const capability = makeDefaultKeysCapability();

          const coinPublicKey1 = capability.getCoinPublicKey(state1);
          const coinPublicKey2 = capability.getCoinPublicKey(state2);

          expect(coinPublicKey1.data).toEqual(coinPublicKey2.data);
        }),
      );
    });

    it('should generate consistent encryption public keys for any seed', () => {
      fc.assert(
        fc.property(seedArbitrary, (seed) => {
          const networkId = NetworkId.NetworkId.Undeployed;
          const state1 = CoreWallet.initEmpty(ledger.ZswapSecretKeys.fromSeed(seed), networkId);
          const state2 = CoreWallet.initEmpty(ledger.ZswapSecretKeys.fromSeed(seed), networkId);
          const capability = makeDefaultKeysCapability();

          const encryptionPublicKey1 = capability.getEncryptionPublicKey(state1);
          const encryptionPublicKey2 = capability.getEncryptionPublicKey(state2);

          expect(encryptionPublicKey1.data).toEqual(encryptionPublicKey2.data);
        }),
      );
    });

    it('should generate addresses composed of coin and encryption public keys for any seed', () => {
      fc.assert(
        fc.property(seedArbitrary, (seed) => {
          const secretKeys = ledger.ZswapSecretKeys.fromSeed(seed);
          const state = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const coinPublicKey = capability.getCoinPublicKey(state);
          const encryptionPublicKey = capability.getEncryptionPublicKey(state);
          const address = capability.getAddress(state);

          expect(address.coinPublicKey.data).toEqual(coinPublicKey.data);
          expect(address.encryptionPublicKey.data).toEqual(encryptionPublicKey.data);
        }),
      );
    });

    it('should generate different coin public keys for different seeds', () => {
      fc.assert(
        fc.property(differentSeedsArbitrary, ([seed1, seed2]) => {
          const secretKeys1 = ledger.ZswapSecretKeys.fromSeed(seed1);
          const secretKeys2 = ledger.ZswapSecretKeys.fromSeed(seed2);
          const state1 = CoreWallet.initEmpty(secretKeys1, NetworkId.NetworkId.Undeployed);
          const state2 = CoreWallet.initEmpty(secretKeys2, NetworkId.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const coinPublicKey1 = capability.getCoinPublicKey(state1);
          const coinPublicKey2 = capability.getCoinPublicKey(state2);

          expect(coinPublicKey1.data).not.toEqual(coinPublicKey2.data);
        }),
      );
    });

    it('should generate different encryption public keys for different seeds', () => {
      fc.assert(
        fc.property(differentSeedsArbitrary, ([seed1, seed2]) => {
          const secretKeys1 = ledger.ZswapSecretKeys.fromSeed(seed1);
          const secretKeys2 = ledger.ZswapSecretKeys.fromSeed(seed2);
          const state1 = CoreWallet.initEmpty(secretKeys1, NetworkId.NetworkId.Undeployed);
          const state2 = CoreWallet.initEmpty(secretKeys2, NetworkId.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const encryptionPublicKey1 = capability.getEncryptionPublicKey(state1);
          const encryptionPublicKey2 = capability.getEncryptionPublicKey(state2);

          expect(encryptionPublicKey1.data).not.toEqual(encryptionPublicKey2.data);
        }),
      );
    });

    it('should generate different addresses for different seeds', () => {
      fc.assert(
        fc.property(differentSeedsArbitrary, ([seed1, seed2]) => {
          const secretKeys1 = ledger.ZswapSecretKeys.fromSeed(seed1);
          const secretKeys2 = ledger.ZswapSecretKeys.fromSeed(seed2);
          const state1 = CoreWallet.initEmpty(secretKeys1, NetworkId.NetworkId.Undeployed);
          const state2 = CoreWallet.initEmpty(secretKeys2, NetworkId.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const address1 = capability.getAddress(state1);
          const address2 = capability.getAddress(state2);

          expect(address1.coinPublicKey.data).not.toEqual(address2.coinPublicKey.data);
          expect(address1.encryptionPublicKey.data).not.toEqual(address2.encryptionPublicKey.data);
        }),
      );
    });
  });

  describe('when constructing addresses', () => {
    it('should construct addresses from coin and encryption public keys for any seed', () => {
      fc.assert(
        fc.property(seedArbitrary, (seed) => {
          const secretKeys = ledger.ZswapSecretKeys.fromSeed(seed);
          const state = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const coinPublicKey = capability.getCoinPublicKey(state);
          const encryptionPublicKey = capability.getEncryptionPublicKey(state);
          const address = capability.getAddress(state);

          // Address should be composed of the individual public keys
          expect(address.coinPublicKey.data).toEqual(coinPublicKey.data);
          expect(address.encryptionPublicKey.data).toEqual(encryptionPublicKey.data);
        }),
      );
    });
  });
});
