import * as Brand from 'effect/Brand';
import * as Schema from 'effect/Schema';

/**
 * A branded `bigint` that represents a protocol version.
 */
export type ProtocolVersion = Brand.Branded<bigint, 'ProtocolVersion'>;

/**
 * Constructs a branded `bigint` represents a protocol version.
 */
export const ProtocolVersion = Brand.nominal<ProtocolVersion>();

export declare namespace ProtocolVersion {
  /**
   * A tuple type that represents a start and ending protocol version.
   */
  type Range = readonly [start: ProtocolVersion, end: ProtocolVersion];
}

/**
 * Creates a new protocol version range.
 *
 * @param start The start value.
 * @param end The end value.
 * @returns A {@link ProtocolVersion.Range} defined by `start` and `end`.
 *
 * @throws `TypeError`
 * Thrown when `start` is after `end`, or the difference between them is less than one.
 */
export const makeRange = (start: ProtocolVersion, end: ProtocolVersion): ProtocolVersion.Range => {
  if (end - start < 1) throw new TypeError('Invalid protocol version range.');
  return [start, end] as const;
};

/**
 * Determines if a given protocol version is within a given range.
 *
 * @param version The version to test.
 * @param range The {@link ProtocolVersion.Range} to test `version` against.
 * @returns `true` if `version` is within the range defined by `range`.
 */
export const withinRange = (version: ProtocolVersion, range: ProtocolVersion.Range): boolean => {
  const [min, max] = range;
  return version >= min && version < max;
};

/**
 * A schema that transforms a `bigint` into a {@link ProtocolVersion}.
 */
export const ProtocolVersionSchema = Schema.BigInt.pipe(Schema.fromBrand(ProtocolVersion));

/**
 * A type predicate that determines if a given value is a {@link ProtocolVersion}.
 *
 * @param u The value to test.
 * @returns `true` if `u` has the type {@link ProtocolVersion}.
 */
export const is = Schema.is(ProtocolVersionSchema);

/**
 * Represents the minimum supported protocol version.
 */
export const MinSupportedVersion = ProtocolVersion(0n);

/**
 * Represents the maximum supported protocol version.
 */
export const MaxSupportedVersion = ProtocolVersion(BigInt(Number.MAX_SAFE_INTEGER));
