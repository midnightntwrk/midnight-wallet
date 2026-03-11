import * as fc from 'fast-check';
import type { DesiredOutput, DesiredInput } from '@midnight-ntwrk/dapp-connector-api';
import { ConnectorMetadata } from './index.js';
import type { ConnectorConfiguration } from './types.js';
import { SemVer } from 'semver';
import { pipe } from 'effect';

export const randomValue = <T>(arbitrary: fc.Arbitrary<T>): T => {
  return fc.sample(arbitrary, 1).at(0)!;
};

const networkIdArbitrary = fc.oneof(
  fc.constantFrom('mainnet', 'testnet', 'devnet', 'qanet', 'preview', 'preprod'),
  fc.string({ minLength: 1, maxLength: 20 }),
);

const httpUrlArbitrary = fc.webUrl({ validSchemes: ['http', 'https'] });
const wsUrlArbitrary = fc.webUrl({ validSchemes: ['ws', 'wss'] });

export const defaultConnectorConfigurationArbitrary: fc.Arbitrary<ConnectorConfiguration> = fc.record({
  networkId: networkIdArbitrary,
  indexerUri: httpUrlArbitrary,
  indexerWsUri: wsUrlArbitrary,
  substrateNodeUri: wsUrlArbitrary,
  proverServerUri: fc.option(httpUrlArbitrary, { nil: undefined }),
});

const nameArbitrary = fc.oneof(fc.string(), fc.lorem({ maxCount: 10 }));
const iconArbitrary = fc.oneof(
  fc.constant(''),
  fc.string(),
  fc.webUrl({
    validSchemes: ['http', 'https'],
    withFragments: true,
    withQueryParameters: true,
  }),
  fc
    .record({
      data: fc.uint8Array().map((data) => Buffer.from(data).toString('base64')),
      mimeType: fc.constantFrom('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'),
    })
    .map(({ data, mimeType }) => `data:${mimeType};base64,${data}`),
);
const rdnsArbitrary = fc.oneof(
  fc.string(),
  fc.lorem({ maxCount: 10 }).map((words) =>
    words
      .split(' ')
      .map((word) => word.toLowerCase())
      .join('.'),
  ),
  fc.domain().map((domain) => domain.split('.').toReversed().join('.')),
);

const repeat =
  <T>(n: number, cb: (acc: T, n: number) => T) =>
  (initial: T): T => {
    let acc = initial;
    for (let i = 0; i < n; i++) {
      acc = cb(acc, i);
    }
    return acc;
  };

const compatibleVersionArbitrary = fc
  .record({
    minorIncrements: fc.nat({ max: 100 }),
    patchIncrements: fc.nat({ max: 100 }),
  })
  .map(({ minorIncrements, patchIncrements }) => {
    const currentVersion = ConnectorMetadata.currentApiVersion;
    return pipe(
      currentVersion,
      repeat(minorIncrements, (ver) => ver.inc('minor')),
      repeat(patchIncrements, (ver) => ver.inc('patch')),
    );
  });

const anyVersionArbitrary = fc
  .record({
    major: fc.nat(),
    minor: fc.nat(),
    patch: fc.nat(),
    prerelease: fc.option(
      fc.record({
        type: fc.constantFrom('beta', 'alpha', 'rc'),
        version: fc.nat(),
      }),
    ),
  })
  .map(({ major, minor, patch, prerelease }) => {
    const prereleaseSuffix = prerelease ? `-${prerelease.type}.${prerelease.version}` : '';
    return new SemVer(`${major}.${minor}.${patch}${prereleaseSuffix}`);
  });

export const defaultConnectorMetadataArbitrary = fc.record({
  name: nameArbitrary,
  icon: iconArbitrary,
  apiVersion: compatibleVersionArbitrary.map((ver: SemVer): string => ver.format()),
  rdns: rdnsArbitrary,
});

export const anyConnectorMetadataArbitrary = fc.record({
  name: nameArbitrary,
  icon: iconArbitrary,
  apiVersion: fc.oneof(compatibleVersionArbitrary, anyVersionArbitrary).map((ver: SemVer): string => ver.format()),
  rdns: rdnsArbitrary,
});

// Token type is a 256-bit hash represented as 64 hex characters
export const tokenTypeArbitrary: fc.Arbitrary<string> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString('hex'));

// Import address types for creating test addresses
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
  MidnightBech32m,
} from '@midnight-ntwrk/wallet-sdk-address-format';

// Test address data for use in arbitraries
// Using deterministic data for reproducible tests
const testCoinPublicKeyData = Buffer.from('064e092a80b33bee23404c46cfc48fec75a2356a9b01178dd6a62c29f5896f67', 'hex');
const testEncryptionPublicKeyData = Buffer.from(
  '0300063c7753854aea18aa11f04d77b3c7eaa0918e4aa98d5eaf0704d8f4c2fc',
  'hex',
);
const testUnshieldedAddressData = Buffer.from(
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  'hex',
);

// Create real address instances
const testShieldedCoinPublicKey = new ShieldedCoinPublicKey(testCoinPublicKeyData);
const testShieldedEncryptionPublicKey = new ShieldedEncryptionPublicKey(testEncryptionPublicKeyData);
const testShieldedAddressInstance = new ShieldedAddress(testShieldedCoinPublicKey, testShieldedEncryptionPublicKey);
const testUnshieldedAddressInstance = new UnshieldedAddress(testUnshieldedAddressData);

/**
 * Creates a DesiredOutput arbitrary for the specified network.
 * The recipient addresses are valid Bech32m encoded addresses for the network.
 */
export const desiredOutputArbitrary = (networkId: string): fc.Arbitrary<DesiredOutput> => {
  const shieldedAddress = MidnightBech32m.encode(networkId, testShieldedAddressInstance).asString();
  const unshieldedAddress = MidnightBech32m.encode(networkId, testUnshieldedAddressInstance).asString();

  return fc.oneof(
    fc.record({
      kind: fc.constant('shielded' as const),
      type: tokenTypeArbitrary,
      value: fc.bigInt({ min: 1n, max: 1000000000n }),
      recipient: fc.constant(shieldedAddress),
    }),
    fc.record({
      kind: fc.constant('unshielded' as const),
      type: tokenTypeArbitrary,
      value: fc.bigInt({ min: 1n, max: 1000000000n }),
      recipient: fc.constant(unshieldedAddress),
    }),
  );
};

/**
 * Creates a DesiredInput arbitrary for generating random inputs.
 */
export const desiredInputArbitrary: fc.Arbitrary<DesiredInput> = fc.oneof(
  fc.record({
    kind: fc.constant('shielded' as const),
    type: tokenTypeArbitrary,
    value: fc.bigInt({ min: 1n, max: 1000000000n }),
  }),
  fc.record({
    kind: fc.constant('unshielded' as const),
    type: tokenTypeArbitrary,
    value: fc.bigInt({ min: 1n, max: 1000000000n }),
  }),
);

// ============================================================================
// Transaction Verification Helpers
// ============================================================================

import * as ledger from '@midnight-ntwrk/ledger-v7';

/**
 * Deserializes a finalized transaction from hex string.
 */
export function deserializeTransaction(txHex: string): ledger.FinalizedTransaction {
  return ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(txHex, 'hex'));
}

/**
 * Gets all segment IDs in a transaction (always includes guaranteed section 0).
 */
export function getSegmentIds(tx: ledger.FinalizedTransaction): number[] {
  return [
    0, // Always include guaranteed section
    ...Array.from(tx.intents?.keys() ?? []),
    ...Array.from(tx.fallibleOffer?.keys() ?? []),
  ].filter((id, index, arr) => arr.indexOf(id) === index);
}

/**
 * Checks if transaction has DustSpend actions.
 */
export function hasDustSpend(tx: ledger.FinalizedTransaction): boolean {
  return Array.from(tx.intents?.values() ?? []).some((intent) => (intent.dustActions?.spends.length ?? 0) > 0);
}

/**
 * Gets total fees paid in transaction.
 */
export function getTotalFees(tx: ledger.FinalizedTransaction): bigint {
  return Array.from(tx.intents?.values() ?? [])
    .flatMap((intent) => intent.dustActions?.spends ?? [])
    .reduce((sum, spend) => sum + spend.vFee, 0n);
}

/**
 * Gets all imbalances across all segments.
 */
export function getAllImbalances(tx: ledger.FinalizedTransaction): Map<ledger.TokenType, bigint> {
  return getSegmentIds(tx).reduce((acc, segmentId) => {
    for (const [tokenType, imbalance] of tx.imbalances(segmentId)) {
      acc.set(tokenType, (acc.get(tokenType) ?? 0n) + imbalance);
    }
    return acc;
  }, new Map<ledger.TokenType, bigint>());
}

/**
 * Checks if transaction is balanced (all imbalances are zero).
 */
export function isTransactionBalanced(tx: ledger.FinalizedTransaction): boolean {
  return getAllImbalances(tx).values().every((imbalance) => imbalance === 0n);
}

/**
 * Counts shielded outputs in transaction.
 */
export function countShieldedOutputs(tx: ledger.FinalizedTransaction): number {
  return (
    (tx.guaranteedOffer?.outputs.length ?? 0) +
    Array.from(tx.fallibleOffer?.values() ?? []).reduce((sum, offer) => sum + offer.outputs.length, 0)
  );
}

/**
 * Counts unshielded outputs in transaction.
 */
export function countUnshieldedOutputs(tx: ledger.FinalizedTransaction): number {
  return Array.from(tx.intents?.values() ?? []).reduce(
    (sum, intent) =>
      sum +
      (intent.guaranteedUnshieldedOffer?.outputs.length ?? 0) +
      (intent.fallibleUnshieldedOffer?.outputs.length ?? 0),
    0,
  );
}

/**
 * Checks if unshielded offers have signatures.
 */
export function hasUnshieldedSignatures(tx: ledger.FinalizedTransaction): boolean {
  return Array.from(tx.intents?.values() ?? []).some(
    (intent) =>
      (intent.guaranteedUnshieldedOffer?.signatures.length ?? 0) > 0 ||
      (intent.fallibleUnshieldedOffer?.signatures.length ?? 0) > 0,
  );
}

/**
 * Gets shielded deltas by token type from ZswapOffers.
 * Note: Individual shielded outputs don't expose value/type directly (they're committed).
 * We use the offer's deltas map which tracks the net value change per token type.
 */
export function getShieldedDeltas(tx: ledger.FinalizedTransaction): Map<ledger.RawTokenType, bigint> {
  const result = new Map<ledger.RawTokenType, bigint>();
  const addDelta = (tokenType: ledger.RawTokenType, delta: bigint) => {
    result.set(tokenType, (result.get(tokenType) ?? 0n) + delta);
  };

  for (const [type, delta] of tx.guaranteedOffer?.deltas ?? []) {
    addDelta(type, delta);
  }
  for (const offer of tx.fallibleOffer?.values() ?? []) {
    for (const [type, delta] of offer.deltas) {
      addDelta(type, delta);
    }
  }
  return result;
}

/**
 * Gets all unshielded output values by token type.
 */
export function getUnshieldedOutputsByTokenType(tx: ledger.FinalizedTransaction): Map<ledger.RawTokenType, bigint[]> {
  const result = new Map<ledger.RawTokenType, bigint[]>();
  const addOutput = (tokenType: ledger.RawTokenType, value: bigint) => {
    const values = result.get(tokenType) ?? [];
    values.push(value);
    result.set(tokenType, values);
  };

  for (const intent of tx.intents?.values() ?? []) {
    for (const output of intent.guaranteedUnshieldedOffer?.outputs ?? []) {
      addOutput(output.type, output.value);
    }
    for (const output of intent.fallibleUnshieldedOffer?.outputs ?? []) {
      addOutput(output.type, output.value);
    }
  }
  return result;
}

/**
 * Computes expected imbalances from desired inputs and outputs.
 * Inputs: wallet provides → negative imbalance
 * Outputs: wallet wants to receive (creates output for counterparty) → positive imbalance
 */
export function computeExpectedImbalances(
  desiredInputs: DesiredInput[],
  desiredOutputs: DesiredOutput[],
): Map<string, bigint> {
  return [...desiredInputs, ...desiredOutputs].reduce((acc, item) => {
    const sign = 'recipient' in item ? 1n : -1n; // outputs have recipient, inputs don't
    acc.set(item.type, (acc.get(item.type) ?? 0n) + sign * item.value);
    return acc;
  }, new Map<string, bigint>());
}

/**
 * Checks if all intents have valid TTL (non-null Date).
 */
export function hasValidTtl(tx: ledger.FinalizedTransaction): boolean {
  return Array.from(tx.intents?.values() ?? []).every((intent) => intent.ttl instanceof Date);
}

/**
 * Gets all TTLs from intents.
 */
export function getIntentTtls(tx: ledger.FinalizedTransaction): Date[] {
  return Array.from(tx.intents?.values() ?? []).map((intent) => intent.ttl);
}

/**
 * Result type for transaction verification.
 */
export type TransactionVerification = {
  shieldedOutputCount: number;
  unshieldedOutputCount: number;
  shieldedDeltas: Map<ledger.RawTokenType, bigint>;
  unshieldedOutputs: Map<ledger.RawTokenType, bigint[]>;
  imbalances: Map<ledger.TokenType, bigint>;
  isBalanced: boolean;
  hasDustSpend: boolean;
  hasUnshieldedSignatures: boolean;
  hasValidTtl: boolean;
  totalFees: bigint;
};

/**
 * Extracts all verifiable properties from a transaction.
 */
export function verifyTransaction(tx: ledger.FinalizedTransaction): TransactionVerification {
  return {
    shieldedOutputCount: countShieldedOutputs(tx),
    unshieldedOutputCount: countUnshieldedOutputs(tx),
    shieldedDeltas: getShieldedDeltas(tx),
    unshieldedOutputs: getUnshieldedOutputsByTokenType(tx),
    imbalances: getAllImbalances(tx),
    isBalanced: isTransactionBalanced(tx),
    hasDustSpend: hasDustSpend(tx),
    hasUnshieldedSignatures: hasUnshieldedSignatures(tx),
    hasValidTtl: hasValidTtl(tx),
    totalFees: getTotalFees(tx),
  };
}
