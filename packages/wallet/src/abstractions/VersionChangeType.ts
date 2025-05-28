import { Data } from 'effect';
import { ProtocolVersion } from './ProtocolVersion';

/**
 * A tagged enum data type that represents a change in Midnight protocol versions.
 *
 * @remarks
 * A specific protocol version can be specified using the {@link VersionChangeType.Version} enum variant. It has a
 * `version` property that accepts a {@link ProtocolVersion} value for a known protocol version.
 * For use cases where a specific protocol version cannot be given, the {@link VersionChangeType.Next} enum variant
 * can be used. Its use is context specific.
 */
export type VersionChangeType = Data.TaggedEnum<{
  /** A change to a particular protocol version. */
  Version: { readonly version: ProtocolVersion };

  /** A change to the 'next' protocol version. Particularly useful in testing */
  Next: {}; // eslint-disable-line @typescript-eslint/no-empty-object-type
}>;
const VersionChangeType = Data.taggedEnum<VersionChangeType>();

/**
 * A type predicate that determines if a given value is a {@link VersionChangeType.Version} enum variant.
 */
export const isVersion = VersionChangeType.$is('Version');

/**
 * A type predicate that determines if a given value is a {@link VersionChangeType.Next} enum variant.
 */
export const isNext = VersionChangeType.$is('Next');

export const { $match: match, Version, Next } = VersionChangeType;
