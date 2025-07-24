import * as zswap from '@midnight-ntwrk/zswap';
import { makeDefaultKeysCapability } from '../Keys';
import { initEmptyState } from '../RunningV1Variant';
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
          const networkId = zswap.NetworkId.Undeployed;
          const state1 = initEmptyState(zswap.SecretKeys.fromSeed(seed), networkId);
          const state2 = initEmptyState(zswap.SecretKeys.fromSeed(seed), networkId);
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
          const networkId = zswap.NetworkId.Undeployed;
          const state1 = initEmptyState(zswap.SecretKeys.fromSeed(seed), networkId);
          const state2 = initEmptyState(zswap.SecretKeys.fromSeed(seed), networkId);
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
          const secretKeys = zswap.SecretKeys.fromSeed(seed);
          const state = initEmptyState(secretKeys, zswap.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const coinPublicKey = capability.getCoinPublicKey(state);
          const encryptionPublicKey = capability.getEncryptionPublicKey(state);
          const address = capability.getAddress(state);

          expect(address.coinPublicKey.data).toEqual(coinPublicKey.data);
          expect(address.encryptionPublicKey.data).toEqual(encryptionPublicKey.data);
        }),
      );
    });

    it('should generate consistent encryption secret keys for any seed', () => {
      fc.assert(
        fc.property(seedArbitrary, (seed) => {
          const networkId = zswap.NetworkId.Undeployed;
          const state1 = initEmptyState(zswap.SecretKeys.fromSeed(seed), networkId);
          const state2 = initEmptyState(zswap.SecretKeys.fromSeed(seed), networkId);
          const capability = makeDefaultKeysCapability();

          const encryptionSecretKey1 = capability.getEncryptionSecretKey(state1);
          const encryptionSecretKey2 = capability.getEncryptionSecretKey(state2);

          // Need to serialize to compare the actual key data, because internal __wbg_ptr always changes
          const serialized1 = encryptionSecretKey1.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize(
            zswap.NetworkId.Undeployed,
          );
          const serialized2 = encryptionSecretKey2.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize(
            zswap.NetworkId.Undeployed,
          );

          expect(Buffer.from(serialized1)).toEqual(Buffer.from(serialized2));
        }),
      );
    });

    it('should generate different coin public keys for different seeds', () => {
      fc.assert(
        fc.property(differentSeedsArbitrary, ([seed1, seed2]) => {
          const secretKeys1 = zswap.SecretKeys.fromSeed(seed1);
          const secretKeys2 = zswap.SecretKeys.fromSeed(seed2);
          const state1 = initEmptyState(secretKeys1, zswap.NetworkId.Undeployed);
          const state2 = initEmptyState(secretKeys2, zswap.NetworkId.Undeployed);
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
          const secretKeys1 = zswap.SecretKeys.fromSeed(seed1);
          const secretKeys2 = zswap.SecretKeys.fromSeed(seed2);
          const state1 = initEmptyState(secretKeys1, zswap.NetworkId.Undeployed);
          const state2 = initEmptyState(secretKeys2, zswap.NetworkId.Undeployed);
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
          const secretKeys1 = zswap.SecretKeys.fromSeed(seed1);
          const secretKeys2 = zswap.SecretKeys.fromSeed(seed2);
          const state1 = initEmptyState(secretKeys1, zswap.NetworkId.Undeployed);
          const state2 = initEmptyState(secretKeys2, zswap.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const address1 = capability.getAddress(state1);
          const address2 = capability.getAddress(state2);

          expect(address1.coinPublicKey.data).not.toEqual(address2.coinPublicKey.data);
          expect(address1.encryptionPublicKey.data).not.toEqual(address2.encryptionPublicKey.data);
        }),
      );
    });

    it('should generate different encryption secret keys for different seeds', () => {
      fc.assert(
        fc.property(differentSeedsArbitrary, ([seed1, seed2]) => {
          const secretKeys1 = zswap.SecretKeys.fromSeed(seed1);
          const secretKeys2 = zswap.SecretKeys.fromSeed(seed2);
          const state1 = initEmptyState(secretKeys1, zswap.NetworkId.Undeployed);
          const state2 = initEmptyState(secretKeys2, zswap.NetworkId.Undeployed);
          const capability = makeDefaultKeysCapability();

          const encryptionSecretKey1 = capability.getEncryptionSecretKey(state1);
          const encryptionSecretKey2 = capability.getEncryptionSecretKey(state2);

          // Need to serialize to compare the actual key data, because internal __wbg_ptr always changes
          const serialized1 = encryptionSecretKey1.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize(
            zswap.NetworkId.Undeployed,
          );
          const serialized2 = encryptionSecretKey2.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize(
            zswap.NetworkId.Undeployed,
          );

          expect(Buffer.from(serialized1)).not.toEqual(Buffer.from(serialized2));
        }),
      );
    });
  });

  describe('when constructing addresses', () => {
    it('should construct addresses from coin and encryption public keys for any seed', () => {
      fc.assert(
        fc.property(seedArbitrary, (seed) => {
          const secretKeys = zswap.SecretKeys.fromSeed(seed);
          const state = initEmptyState(secretKeys, zswap.NetworkId.Undeployed);
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
