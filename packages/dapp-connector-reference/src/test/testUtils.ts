import { expect } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';

export const expectMatchObjectTyped = <T>(actual: T, expected: Partial<T>): void => {
  expect(actual).toMatchObject(expected);
};

// =============================================================================
// Test Address Infrastructure with Secret Keys
// =============================================================================
// Test addresses are derived from secret keys (not arbitrary data), enabling:
// - Shielded output decryption verification (owner can decrypt using secret keys)
// - Proper address derivation matching real wallet behavior
// =============================================================================

/**
 * A shielded address with its corresponding secret keys retained for testing.
 * Enables verification that outputs can be decrypted by the address owner.
 */
export interface ShieldedAddressWithKeys {
  readonly secretKeys: ledger.ZswapSecretKeys;
  readonly address: ShieldedAddress;
  readonly coinPublicKey: ShieldedCoinPublicKey;
  readonly encryptionPublicKey: ShieldedEncryptionPublicKey;
}

/**
 * An unshielded address with its corresponding secret key retained for testing.
 * Enables signature verification and address ownership checks.
 */
export interface UnshieldedAddressWithKeys {
  readonly secretKey: string; // Hex string for ledger compatibility
  readonly verifyingKey: string; // Public key derived from secret key
  readonly address: UnshieldedAddress;
}

/**
 * Create a shielded address with retained secret keys from a deterministic seed.
 */
export const createShieldedAddressWithKeys = (seed: Uint8Array): ShieldedAddressWithKeys => {
  const secretKeys = ledger.ZswapSecretKeys.fromSeed(seed);
  const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(secretKeys.coinPublicKey, 'hex'));
  const encryptionPublicKey = new ShieldedEncryptionPublicKey(Buffer.from(secretKeys.encryptionPublicKey, 'hex'));
  const address = new ShieldedAddress(coinPublicKey, encryptionPublicKey);
  return { secretKeys, address, coinPublicKey, encryptionPublicKey };
};

/**
 * Create an unshielded address with retained secret key from a deterministic seed.
 */
export const createUnshieldedAddressWithKeys = (seed: Uint8Array): UnshieldedAddressWithKeys => {
  // Create a deterministic secret key from the seed (padded to 32 bytes, non-zero)
  const paddedSeed = new Uint8Array(32);
  paddedSeed.set(seed.slice(0, 32));
  if (paddedSeed.every((b) => b === 0)) paddedSeed[31] = 1; // Ensure non-zero
  const secretKey = Buffer.from(paddedSeed).toString('hex');
  const verifyingKey = ledger.signatureVerifyingKey(secretKey);
  const address = new UnshieldedAddress(Buffer.from(verifyingKey, 'hex'));
  return { secretKey, verifyingKey, address };
};

// =============================================================================
// Standard Test Addresses
// =============================================================================
// Deterministic seeds for reproducible test addresses
const testShieldedSeed1 = new Uint8Array(32).fill(1);
const testShieldedSeed2 = new Uint8Array(32).fill(2);
const testUnshieldedSeed1 = new Uint8Array(32).fill(3);
const testUnshieldedSeed2 = new Uint8Array(32).fill(4);

// Primary test addresses with retained secret keys
export const testShieldedWithKeys = createShieldedAddressWithKeys(testShieldedSeed1);
export const testShieldedWithKeys2 = createShieldedAddressWithKeys(testShieldedSeed2);
export const testUnshieldedWithKeys = createUnshieldedAddressWithKeys(testUnshieldedSeed1);
export const testUnshieldedWithKeys2 = createUnshieldedAddressWithKeys(testUnshieldedSeed2);
