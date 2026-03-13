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
  <T>(n: number, cb: (acc: T, idx: number) => T) =>
  (initial: T): T =>
    Array.from({ length: n }, (_, i) => i).reduce((acc, i) => cb(acc, i), initial);

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
import * as ledger from '@midnight-ntwrk/ledger-v7';

// =============================================================================
// Test Address Infrastructure with Secret Keys
// =============================================================================
// Addresses are derived from deterministic secret keys, enabling:
// - Shielded output decryption verification
// - Proper cryptographic address derivation
// =============================================================================

/**
 * A shielded address with its corresponding secret keys for testing.
 */
export interface ShieldedAddressWithKeys {
  readonly secretKeys: ledger.ZswapSecretKeys;
  readonly address: ShieldedAddress;
  readonly coinPublicKey: ShieldedCoinPublicKey;
  readonly encryptionPublicKey: ShieldedEncryptionPublicKey;
}

/**
 * An unshielded address with its corresponding secret key for testing.
 */
export interface UnshieldedAddressWithKeys {
  readonly secretKey: string;
  readonly verifyingKey: string;
  readonly address: UnshieldedAddress;
}

// Deterministic seeds (must match testUtils.ts for consistency)
const testShieldedSeed1 = new Uint8Array(32).fill(1);
const testUnshieldedSeed1 = new Uint8Array(32).fill(3);

// Create shielded address with retained secret keys
const testShieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(testShieldedSeed1);
const testShieldedCoinPublicKey = new ShieldedCoinPublicKey(
  Buffer.from(testShieldedSecretKeys.coinPublicKey, 'hex'),
);
const testShieldedEncryptionPublicKey = new ShieldedEncryptionPublicKey(
  Buffer.from(testShieldedSecretKeys.encryptionPublicKey, 'hex'),
);
const testShieldedAddressInstance = new ShieldedAddress(testShieldedCoinPublicKey, testShieldedEncryptionPublicKey);

/**
 * Primary test shielded address with retained secret keys.
 * Use this when you need to verify output decryptability.
 */
export const testShieldedWithKeys: ShieldedAddressWithKeys = {
  secretKeys: testShieldedSecretKeys,
  address: testShieldedAddressInstance,
  coinPublicKey: testShieldedCoinPublicKey,
  encryptionPublicKey: testShieldedEncryptionPublicKey,
};

// Create unshielded address with retained secret key
const createPaddedSeed = (seed: Uint8Array): Uint8Array => {
  const padded = new Uint8Array(32);
  padded.set(seed.slice(0, 32));
  return padded.every((b) => b === 0) ? Uint8Array.from([...padded.slice(0, 31), 1]) : padded;
};
const testUnshieldedSecretKey = Buffer.from(createPaddedSeed(testUnshieldedSeed1)).toString('hex');
const testUnshieldedVerifyingKey = ledger.signatureVerifyingKey(testUnshieldedSecretKey);
const testUnshieldedAddressInstance = new UnshieldedAddress(Buffer.from(testUnshieldedVerifyingKey, 'hex'));

/**
 * Primary test unshielded address with retained secret key.
 * Use this when you need to verify recipient addresses.
 */
export const testUnshieldedWithKeys: UnshieldedAddressWithKeys = {
  secretKey: testUnshieldedSecretKey,
  verifyingKey: testUnshieldedVerifyingKey,
  address: testUnshieldedAddressInstance,
};

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
 * Checks if transaction has DustActions indicating fees will be paid.
 * Note: In mock transactions, dustActions may be present but with empty spends array.
 * For production, spends.length > 0 would be expected.
 */
export function hasDustSpend(tx: ledger.FinalizedTransaction): boolean {
  return Array.from(tx.intents?.values() ?? []).some((intent) => intent.dustActions !== undefined);
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
 * Token imbalances by kind (shielded/unshielded).
 * Each is a Record of raw token type (64-char hex) to imbalance value.
 */
export interface TokenImbalances {
  readonly shielded: Readonly<Record<ledger.RawTokenType, bigint>>;
  readonly unshielded: Readonly<Record<ledger.RawTokenType, bigint>>;
}

/**
 * Gets all imbalances across all segments, separated by token kind.
 * Returns Records (plain objects) for easy comparison with toEqual().
 * Note: Dust token imbalances are excluded since DustTokenType has no raw representation.
 */
export function getAllImbalances(tx: ledger.FinalizedTransaction): TokenImbalances {
  const allImbalanceEntries = getSegmentIds(tx).flatMap((segmentId) => Array.from(tx.imbalances(segmentId)));

  const addToRecord = (
    record: Record<ledger.RawTokenType, bigint>,
    key: ledger.RawTokenType,
    value: bigint,
  ): Record<ledger.RawTokenType, bigint> => ({
    ...record,
    [key]: (record[key] ?? 0n) + value,
  });

  const hasRaw = (tokenType: ledger.TokenType): tokenType is ledger.ShieldedTokenType | ledger.UnshieldedTokenType =>
    tokenType.tag !== 'dust';

  return allImbalanceEntries.filter(([tokenType]) => hasRaw(tokenType)).reduce(
    (acc, [tokenType, imbalance]) => {
      const narrowedType = tokenType as ledger.ShieldedTokenType | ledger.UnshieldedTokenType;
      return narrowedType.tag === 'shielded'
        ? { ...acc, shielded: addToRecord(acc.shielded, narrowedType.raw, imbalance) }
        : { ...acc, unshielded: addToRecord(acc.unshielded, narrowedType.raw, imbalance) };
    },
    { shielded: {}, unshielded: {} } as TokenImbalances,
  );
}

/**
 * Checks if transaction is balanced (all imbalances are zero).
 */
export function isTransactionBalanced(tx: ledger.FinalizedTransaction): boolean {
  const imbalances = getAllImbalances(tx);
  const allShieldedZero = Object.values(imbalances.shielded).every((v) => v === 0n);
  const allUnshieldedZero = Object.values(imbalances.unshielded).every((v) => v === 0n);
  return allShieldedZero && allUnshieldedZero;
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
  const guaranteedDeltas = Array.from(tx.guaranteedOffer?.deltas ?? []);
  const fallibleDeltas = Array.from(tx.fallibleOffer?.values() ?? []).flatMap((offer) => Array.from(offer.deltas));
  const allDeltas = [...guaranteedDeltas, ...fallibleDeltas];

  return allDeltas.reduce((acc, [tokenType, delta]) => {
    const current = acc.get(tokenType) ?? 0n;
    return new Map(acc).set(tokenType, current + delta);
  }, new Map<ledger.RawTokenType, bigint>());
}

/**
 * Gets all unshielded output values by token type.
 */
export function getUnshieldedOutputsByTokenType(tx: ledger.FinalizedTransaction): Map<ledger.RawTokenType, bigint[]> {
  const allOutputs = Array.from(tx.intents?.values() ?? []).flatMap((intent) => [
    ...(intent.guaranteedUnshieldedOffer?.outputs ?? []),
    ...(intent.fallibleUnshieldedOffer?.outputs ?? []),
  ]);

  return allOutputs.reduce((acc, output) => {
    const current = acc.get(output.type) ?? [];
    return new Map(acc).set(output.type, [...current, output.value]);
  }, new Map<ledger.RawTokenType, bigint[]>());
}

/**
 * Computes expected imbalances from desired inputs and outputs.
 * Inputs: wallet provides → negative imbalance
 * Outputs: wallet wants to receive (creates output for counterparty) → positive imbalance
 *
 * Returns TokenImbalances with shielded and unshielded separated.
 */
export function computeExpectedImbalances(
  desiredInputs: DesiredInput[],
  desiredOutputs: DesiredOutput[],
): TokenImbalances {
  const addToRecord = (
    record: Record<ledger.RawTokenType, bigint>,
    key: string,
    delta: bigint,
  ): Record<ledger.RawTokenType, bigint> => ({
    ...record,
    [key]: (record[key] ?? 0n) + delta,
  });

  const processItem = (
    acc: TokenImbalances,
    kind: 'shielded' | 'unshielded',
    type: string,
    delta: bigint,
  ): TokenImbalances =>
    kind === 'shielded'
      ? { ...acc, shielded: addToRecord(acc.shielded, type, delta) }
      : { ...acc, unshielded: addToRecord(acc.unshielded, type, delta) };

  const afterInputs = desiredInputs.reduce(
    (acc, input) => processItem(acc, input.kind, input.type, -BigInt(input.value)),
    { shielded: {}, unshielded: {} } as TokenImbalances,
  );

  return desiredOutputs.reduce(
    (acc, output) => processItem(acc, output.kind, output.type, BigInt(output.value)),
    afterInputs,
  );
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

// ============================================================================
// Unshielded Output Info (with full recipient details)
// ============================================================================

/**
 * Full information about an unshielded output.
 */
export interface UnshieldedOutputInfo {
  readonly tokenType: ledger.RawTokenType;
  readonly value: bigint;
  readonly owner: string; // Hex string of verifying key
}

/**
 * Unshielded outputs grouped by intent ID.
 */
export interface UnshieldedOutputsByIntent {
  readonly intentId: number;
  readonly guaranteed: readonly UnshieldedOutputInfo[];
  readonly fallible: readonly UnshieldedOutputInfo[];
}

/**
 * Extracts all unshielded outputs grouped by intent ID.
 */
function extractUnshieldedOutputsByIntent(tx: ledger.FinalizedTransaction): Map<number, UnshieldedOutputsByIntent> {
  const mapOutput = (o: { type: ledger.RawTokenType; value: bigint; owner: string }): UnshieldedOutputInfo => ({
    tokenType: o.type,
    value: o.value,
    owner: o.owner,
  });

  return new Map(
    Array.from(tx.intents ?? []).map(([intentId, intent]) => [
      intentId,
      {
        intentId,
        guaranteed: (intent.guaranteedUnshieldedOffer?.outputs ?? []).map(mapOutput),
        fallible: (intent.fallibleUnshieldedOffer?.outputs ?? []).map(mapOutput),
      },
    ]),
  );
}

// ============================================================================
// Decrypted Shielded Coin Info
// ============================================================================

/**
 * A decrypted shielded coin with token type and value.
 */
export interface DecryptedCoin {
  readonly tokenType: ledger.RawTokenType;
  readonly value: bigint;
}

/**
 * Result of decrypting a shielded offer.
 */
export interface DecryptedShieldedOffer {
  readonly coins: readonly DecryptedCoin[];
}

/**
 * Decrypts the guaranteed shielded offer using the recipient's secret keys.
 * Returns the coins that can be decrypted (owned by this recipient).
 */
function decryptGuaranteedOffer(
  tx: ledger.FinalizedTransaction,
  secretKeys: ledger.ZswapSecretKeys,
): DecryptedShieldedOffer {
  if (tx.guaranteedOffer === undefined) {
    return { coins: [] };
  }

  // Apply the offer to a fresh state to decrypt outputs
  const state = new ledger.ZswapLocalState().apply(secretKeys, tx.guaranteedOffer);

  return {
    coins: Array.from(state.coins).map((coin) => ({
      tokenType: coin.type,
      value: coin.value,
    })),
  };
}

/**
 * Decrypts all shielded offers (guaranteed + fallible) using the recipient's secret keys.
 */
function decryptAllShieldedOffers(
  tx: ledger.FinalizedTransaction,
  secretKeys: ledger.ZswapSecretKeys,
): DecryptedShieldedOffer {
  const allOffers = [
    ...(tx.guaranteedOffer !== undefined ? [tx.guaranteedOffer] : []),
    ...Array.from(tx.fallibleOffer?.values() ?? []),
  ];

  const finalState = allOffers.reduce(
    (state, offer) => state.apply(secretKeys, offer),
    new ledger.ZswapLocalState(),
  );

  return {
    coins: Array.from(finalState.coins).map((coin) => ({
      tokenType: coin.type,
      value: coin.value,
    })),
  };
}

// ============================================================================
// Transaction Verification (Rich Structure with Query Methods)
// ============================================================================

/**
 * Rich transaction verification result with query methods.
 *
 * Captures all verifiable data from a transaction and provides methods
 * to query specific aspects. The structure is designed to:
 * - Allow non-exact matching (wallet may add balancing inputs/outputs)
 * - Support decryption-based verification for shielded outputs
 * - Group data by intent ID for targeted assertions
 */
export interface TransactionVerification {
  // ---- Aggregate counts ----
  readonly shieldedOutputCount: number;
  readonly unshieldedOutputCount: number;

  // ---- Deltas and imbalances ----
  readonly shieldedDeltas: Map<ledger.RawTokenType, bigint>;
  /** @deprecated Use getAllUnshieldedOutputs() or getUnshieldedOutputsForIntent() for exact verification */
  readonly unshieldedOutputs: Map<ledger.RawTokenType, bigint[]>;
  /**
   * Token imbalances separated by kind (shielded/unshielded).
   * Use with computeExpectedImbalances() for direct toEqual() comparison.
   */
  readonly imbalances: TokenImbalances;
  readonly isBalanced: boolean;

  // ---- Intent structure ----
  readonly intentIds: readonly number[];
  readonly hasDustSpend: boolean;
  readonly hasUnshieldedSignatures: boolean;
  readonly hasValidTtl: boolean;
  readonly totalFees: bigint;

  // ---- Unshielded outputs by intent ----
  /**
   * Gets unshielded outputs for a specific intent ID.
   * Returns undefined if intent doesn't exist.
   */
  getUnshieldedOutputsForIntent(intentId: number): UnshieldedOutputsByIntent | undefined;

  /**
   * Gets all unshielded outputs across all intents (flattened).
   */
  getAllUnshieldedOutputs(): readonly UnshieldedOutputInfo[];

  /**
   * Checks if a specific unshielded output exists in an intent's guaranteed section.
   * Allows non-exact matching - additional outputs may exist due to balancing.
   */
  containsGuaranteedUnshieldedOutput(
    intentId: number,
    expected: { owner: string; tokenType: ledger.RawTokenType; value: bigint },
  ): boolean;

  // ---- Shielded offer decryption ----
  /**
   * Decrypts the guaranteed shielded offer using the recipient's secret keys.
   * Returns the coins that the recipient can claim.
   */
  decryptGuaranteedShieldedOffer(secretKeys: ledger.ZswapSecretKeys): DecryptedShieldedOffer;

  /**
   * Decrypts all shielded offers (guaranteed + fallible) using the recipient's secret keys.
   */
  decryptAllShieldedOffers(secretKeys: ledger.ZswapSecretKeys): DecryptedShieldedOffer;

  /**
   * Checks if a specific coin exists in the decrypted guaranteed shielded offer.
   * Allows non-exact matching - additional coins may exist due to balancing.
   */
  containsDecryptedCoin(
    secretKeys: ledger.ZswapSecretKeys,
    expected: { tokenType: ledger.RawTokenType; value: bigint },
  ): boolean;

  // ---- Batch verification methods ----

  /**
   * Checks if ALL expected unshielded outputs exist in the transaction.
   * Allows non-exact matching - additional outputs may exist due to balancing.
   *
   * @example
   * expect(verification.containsUnshieldedOutputs([
   *   { owner: recipient.verifyingKey, tokenType: tokenA, value: 100n },
   *   { owner: recipient.verifyingKey, tokenType: tokenB, value: 50n },
   * ])).toBe(true);
   */
  containsUnshieldedOutputs(
    expected: ReadonlyArray<{ owner: string; tokenType: ledger.RawTokenType; value: bigint }>,
  ): boolean;

  /**
   * Checks if ALL expected shielded outputs can be decrypted by the recipient.
   * Allows non-exact matching - additional coins may exist due to balancing.
   *
   * @example
   * expect(verification.containsShieldedOutputs(recipient.secretKeys, [
   *   { tokenType: tokenA, value: 100n },
   *   { tokenType: tokenB, value: 50n },
   * ])).toBe(true);
   */
  containsShieldedOutputs(
    secretKeys: ledger.ZswapSecretKeys,
    expected: ReadonlyArray<{ tokenType: ledger.RawTokenType; value: bigint }>,
  ): boolean;

  /**
   * Combined check for both shielded and unshielded outputs.
   * Verifies that all expected outputs exist in the transaction.
   *
   * @example
   * expect(verification.containsOutputs({
   *   unshielded: [
   *     { owner: unshieldedRecipient.verifyingKey, tokenType: tokenA, value: 100n },
   *   ],
   *   shielded: {
   *     secretKeys: shieldedRecipient.secretKeys,
   *     outputs: [{ tokenType: tokenB, value: 50n }],
   *   },
   * })).toBe(true);
   */
  containsOutputs(expected: {
    unshielded?: ReadonlyArray<{ owner: string; tokenType: ledger.RawTokenType; value: bigint }>;
    shielded?: {
      secretKeys: ledger.ZswapSecretKeys;
      outputs: ReadonlyArray<{ tokenType: ledger.RawTokenType; value: bigint }>;
    };
  }): boolean;
}

/**
 * Creates a TransactionVerification from a finalized transaction.
 */
export function verifyTransaction(tx: ledger.FinalizedTransaction): TransactionVerification {
  const unshieldedByIntent = extractUnshieldedOutputsByIntent(tx);
  const intentIds = Array.from(tx.intents?.keys() ?? []);

  const allUnshieldedOutputs = Array.from(unshieldedByIntent.values()).flatMap((byIntent) => [
    ...byIntent.guaranteed,
    ...byIntent.fallible,
  ]);

  return {
    // Aggregate counts
    shieldedOutputCount: countShieldedOutputs(tx),
    unshieldedOutputCount: countUnshieldedOutputs(tx),

    // Deltas and imbalances
    shieldedDeltas: getShieldedDeltas(tx),
    unshieldedOutputs: getUnshieldedOutputsByTokenType(tx),
    imbalances: getAllImbalances(tx),
    isBalanced: isTransactionBalanced(tx),

    // Intent structure
    intentIds,
    hasDustSpend: hasDustSpend(tx),
    hasUnshieldedSignatures: hasUnshieldedSignatures(tx),
    hasValidTtl: hasValidTtl(tx),
    totalFees: getTotalFees(tx),

    // Query methods
    getUnshieldedOutputsForIntent(intentId: number): UnshieldedOutputsByIntent | undefined {
      return unshieldedByIntent.get(intentId);
    },

    getAllUnshieldedOutputs(): readonly UnshieldedOutputInfo[] {
      return allUnshieldedOutputs;
    },

    containsGuaranteedUnshieldedOutput(
      intentId: number,
      expected: { owner: string; tokenType: ledger.RawTokenType; value: bigint },
    ): boolean {
      const intent = unshieldedByIntent.get(intentId);
      if (intent === undefined) return false;
      return intent.guaranteed.some(
        (o) => o.owner === expected.owner && o.tokenType === expected.tokenType && o.value === expected.value,
      );
    },

    decryptGuaranteedShieldedOffer(secretKeys: ledger.ZswapSecretKeys): DecryptedShieldedOffer {
      return decryptGuaranteedOffer(tx, secretKeys);
    },

    decryptAllShieldedOffers(secretKeys: ledger.ZswapSecretKeys): DecryptedShieldedOffer {
      return decryptAllShieldedOffers(tx, secretKeys);
    },

    containsDecryptedCoin(
      secretKeys: ledger.ZswapSecretKeys,
      expected: { tokenType: ledger.RawTokenType; value: bigint },
    ): boolean {
      const decrypted = decryptGuaranteedOffer(tx, secretKeys);
      return decrypted.coins.some((c) => c.tokenType === expected.tokenType && c.value === expected.value);
    },

    containsUnshieldedOutputs(
      expected: ReadonlyArray<{ owner: string; tokenType: ledger.RawTokenType; value: bigint }>,
    ): boolean {
      return expected.every((exp) =>
        allUnshieldedOutputs.some(
          (o) => o.owner === exp.owner && o.tokenType === exp.tokenType && o.value === exp.value,
        ),
      );
    },

    containsShieldedOutputs(
      secretKeys: ledger.ZswapSecretKeys,
      expected: ReadonlyArray<{ tokenType: ledger.RawTokenType; value: bigint }>,
    ): boolean {
      const decrypted = decryptGuaranteedOffer(tx, secretKeys);
      return expected.every((exp) =>
        decrypted.coins.some((c) => c.tokenType === exp.tokenType && c.value === exp.value),
      );
    },

    containsOutputs(expected: {
      unshielded?: ReadonlyArray<{ owner: string; tokenType: ledger.RawTokenType; value: bigint }>;
      shielded?: {
        secretKeys: ledger.ZswapSecretKeys;
        outputs: ReadonlyArray<{ tokenType: ledger.RawTokenType; value: bigint }>;
      };
    }): boolean {
      const unshieldedOk =
        expected.unshielded === undefined ||
        expected.unshielded.every((exp) =>
          allUnshieldedOutputs.some(
            (o) => o.owner === exp.owner && o.tokenType === exp.tokenType && o.value === exp.value,
          ),
        );

      const shieldedOk =
        expected.shielded === undefined ||
        (() => {
          const decrypted = decryptGuaranteedOffer(tx, expected.shielded.secretKeys);
          return expected.shielded.outputs.every((exp) =>
            decrypted.coins.some((c) => c.tokenType === exp.tokenType && c.value === exp.value),
          );
        })();

      return unshieldedOk && shieldedOk;
    },
  };
}

// ============================================================================
// Legacy Helpers (for backwards compatibility)
// ============================================================================

/**
 * Unshielded output with its recipient address (owner hex string).
 */
export interface UnshieldedOutputWithRecipient {
  readonly tokenType: ledger.RawTokenType;
  readonly value: bigint;
  readonly owner: string; // Hex string of the owner's verifying key
}

/**
 * Gets all unshielded outputs with their recipient addresses.
 */
export function getUnshieldedOutputsWithRecipients(tx: ledger.FinalizedTransaction): UnshieldedOutputWithRecipient[] {
  return Array.from(tx.intents?.values() ?? []).flatMap((intent) => [
    ...(intent.guaranteedUnshieldedOffer?.outputs ?? []).map((output) => ({
      tokenType: output.type,
      value: output.value,
      owner: output.owner,
    })),
    ...(intent.fallibleUnshieldedOffer?.outputs ?? []).map((output) => ({
      tokenType: output.type,
      value: output.value,
      owner: output.owner,
    })),
  ]);
}

/**
 * Verifies that all unshielded outputs have the expected recipient address.
 * Returns true if all outputs match the expected address (by verifying key).
 */
export function verifyUnshieldedRecipient(
  tx: ledger.FinalizedTransaction,
  expectedAddress: UnshieldedAddressWithKeys,
): boolean {
  return getUnshieldedOutputsWithRecipients(tx).every((output) => output.owner === expectedAddress.verifyingKey);
}

/**
 * Verifies that all unshielded outputs for a specific token type have the expected recipient.
 */
export function verifyUnshieldedRecipientForToken(
  tx: ledger.FinalizedTransaction,
  tokenType: ledger.RawTokenType,
  expectedAddress: UnshieldedAddressWithKeys,
): boolean {
  return getUnshieldedOutputsWithRecipients(tx)
    .filter((output) => output.tokenType === tokenType)
    .every((output) => output.owner === expectedAddress.verifyingKey);
}

/**
 * A decrypted shielded coin with its token type and value.
 */
export interface DecryptedShieldedCoin {
  readonly tokenType: ledger.RawTokenType;
  readonly value: bigint;
}

/**
 * Decrypts shielded outputs from a transaction using the recipient's secret keys.
 * Returns the coins that the recipient can decrypt and claim.
 *
 * This is the proper way to verify shielded outputs - by actually decrypting them
 * with the recipient's keys, which proves ownership and reveals the (tokenType, value).
 */
export function decryptShieldedOutputs(
  tx: ledger.FinalizedTransaction,
  secretKeys: ledger.ZswapSecretKeys,
): DecryptedShieldedCoin[] {
  const allOffers = [
    ...(tx.guaranteedOffer !== undefined ? [tx.guaranteedOffer] : []),
    ...Array.from(tx.fallibleOffer?.values() ?? []),
  ];

  const finalState = allOffers.reduce(
    (state, offer) => state.apply(secretKeys, offer),
    new ledger.ZswapLocalState(),
  );

  return Array.from(finalState.coins).map((coin) => ({
    tokenType: coin.type,
    value: coin.value,
  }));
}

/**
 * Verifies that a recipient received the expected shielded outputs.
 * Decrypts the outputs using the recipient's secret keys and checks that
 * the decrypted coins match the expected (tokenType, value) pairs exactly.
 *
 * @param tx - The finalized transaction to verify
 * @param secretKeys - The recipient's secret keys for decryption
 * @param expectedOutputs - Array of expected (tokenType, value) pairs
 * @returns true if the decrypted coins match expected outputs exactly
 */
export function verifyShieldedOutputsReceived(
  tx: ledger.FinalizedTransaction,
  secretKeys: ledger.ZswapSecretKeys,
  expectedOutputs: Array<{ tokenType: ledger.RawTokenType; value: bigint }>,
): boolean {
  const decrypted = decryptShieldedOutputs(tx, secretKeys);

  // Check same count
  if (decrypted.length !== expectedOutputs.length) {
    return false;
  }

  // Sort both arrays for comparison (by tokenType then value)
  const sortFn = (a: { tokenType: string; value: bigint }, b: { tokenType: string; value: bigint }) => {
    const typeCompare = a.tokenType.localeCompare(b.tokenType);
    return typeCompare !== 0 ? typeCompare : Number(a.value - b.value);
  };

  const sortedDecrypted = [...decrypted].sort(sortFn);
  const sortedExpected = [...expectedOutputs].sort(sortFn);

  return sortedDecrypted.every(
    (coin, i) => coin.tokenType === sortedExpected[i].tokenType && coin.value === sortedExpected[i].value,
  );
}

/**
 * Expected output specification for verification.
 */
export interface ExpectedOutput {
  readonly kind: 'shielded' | 'unshielded';
  readonly tokenType: ledger.RawTokenType;
  readonly value: bigint;
  readonly recipientSecretKeys?: ledger.ZswapSecretKeys; // For shielded
  readonly recipientVerifyingKey?: string; // For unshielded (hex)
}

/**
 * Verifies that all expected outputs are present in the transaction.
 * For shielded outputs: decrypts using the recipient's keys and verifies (tokenType, value)
 * For unshielded outputs: verifies the exact (owner, tokenType, value) tuple
 *
 * @param tx - The finalized transaction to verify
 * @param expectedOutputs - Array of expected outputs with recipient info
 * @returns Object with verification results
 */
export function verifyExactOutputs(
  tx: ledger.FinalizedTransaction,
  expectedOutputs: ExpectedOutput[],
): { success: boolean; errors: string[] } {
  // Group expected outputs by recipient using reduce
  const groupByRecipient = <K extends string>(
    outputs: ExpectedOutput[],
    keyFn: (o: ExpectedOutput) => K | undefined,
  ): Map<K, ExpectedOutput[]> =>
    outputs.reduce((acc, output) => {
      const key = keyFn(output);
      if (key === undefined) return acc;
      const existing = acc.get(key) ?? [];
      return new Map(acc).set(key, [...existing, output]);
    }, new Map<K, ExpectedOutput[]>());

  const shieldedByRecipient = groupByRecipient(
    expectedOutputs.filter((o) => o.kind === 'shielded' && o.recipientSecretKeys !== undefined),
    (o) => o.recipientSecretKeys?.coinPublicKey,
  );

  const unshieldedByRecipient = groupByRecipient(
    expectedOutputs.filter((o) => o.kind === 'unshielded' && o.recipientVerifyingKey !== undefined),
    (o) => o.recipientVerifyingKey,
  );

  // Verify shielded outputs by decryption
  const shieldedErrors = Array.from(shieldedByRecipient.values()).flatMap((outputs) => {
    const secretKeys = outputs[0].recipientSecretKeys!;
    const decrypted = decryptShieldedOutputs(tx, secretKeys);

    return outputs
      .filter((expected) => !decrypted.some((d) => d.tokenType === expected.tokenType && d.value === expected.value))
      .map(
        (expected) =>
          `Shielded output not found: expected ${expected.value} of token ${expected.tokenType} for recipient`,
      );
  });

  // Verify unshielded outputs by exact match
  const actualUnshielded = getUnshieldedOutputsWithRecipients(tx);

  const unshieldedErrors = Array.from(unshieldedByRecipient.entries()).flatMap(([verifyingKey, outputs]) =>
    outputs
      .filter(
        (expected) =>
          !actualUnshielded.some(
            (a) => a.owner === verifyingKey && a.tokenType === expected.tokenType && a.value === expected.value,
          ),
      )
      .map(
        (expected) =>
          `Unshielded output not found: expected ${expected.value} of token ${expected.tokenType} for recipient ${verifyingKey.slice(0, 16)}...`,
      ),
  );

  const errors = [...shieldedErrors, ...unshieldedErrors];
  return { success: errors.length === 0, errors };
}
