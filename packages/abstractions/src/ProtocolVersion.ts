// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import * as Brand from 'effect/Brand';
import * as Data from 'effect/Data';
import * as Either from 'effect/Either';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

/** A branded `bigint` that represents a protocol version. */
export type ProtocolVersion = Brand.Branded<bigint, 'ProtocolVersion'>;

/** Constructs a branded `bigint` represents a protocol version. */
export const ProtocolVersion = Brand.nominal<ProtocolVersion>();

export declare namespace ProtocolVersion {
  /** A tuple type that represents a start and ending protocol version. */
  type Range = readonly [start: ProtocolVersion, end: ProtocolVersion];
}

/**
 * Creates a new protocol version range.
 *
 * @param start The start value.
 * @param end The end value.
 * @returns A {@link ProtocolVersion.Range} defined by `start` and `end`.
 * @throws `TypeError` Thrown when `start` is after `end`, or the difference between them is less than one.
 */
// TODO: make it possible to represent an open range on the end side to remove special "MaxSupportedVersion"
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

/** A schema that transforms a `bigint` into a {@link ProtocolVersion}. */
export const ProtocolVersionSchema = Schema.BigInt.pipe(Schema.fromBrand(ProtocolVersion));

/**
 * A type predicate that determines if a given value is a {@link ProtocolVersion}.
 *
 * @param u The value to test.
 * @returns `true` if `u` has the type {@link ProtocolVersion}.
 */
export const is = Schema.is(ProtocolVersionSchema);

/** Represents the minimum supported protocol version. */
export const MinSupportedVersion = ProtocolVersion(0n);

/** Represents the maximum supported protocol version. */
export const MaxSupportedVersion = ProtocolVersion(BigInt(Number.MAX_SAFE_INTEGER));

/**
 * The protocol version a ledger-v9-native chain hands over at, for the current node line.
 *
 * @remarks
 *   Measured, not assumed: a `midnight-node` 2.x reports protocol version `2000000` on its ledger events — the runtime
 *   version, scaled, rather than a small ordinal or the ledger major. A chain of the previous node line reports a
 *   1.x-encoded value, which is below this, so a wallet configured with it stays on the V1 variant there and reaches
 *   the V2 variant on any v9-native chain.
 *
 *   Offered as a named value so applications and test suites pointed at a v9-native chain do not each invent a magic
 *   number. It is **not** a default: every wallet's `forks.v9` stays required, because the right value is a property of
 *   the chain an application points at. The final mainnet fork constant is still an open question; when it is fixed it
 *   will join this one here.
 */
export const V9NativeForkVersion: ProtocolVersion = ProtocolVersion(2_000_000n);

/**
 * Where each ledger version after the first begins on a chain, by protocol version.
 *
 * @remarks
 *   One key per ledger version the SDK can run, minus the first: ledger-v8 begins at {@link MinSupportedVersion} and needs
 *   no entry. `v9` is the protocol version from which ledger-v9 reads the chain — {@link V9NativeForkVersion} on a chain
 *   born on ledger-v9, and whatever version the hand-over is enacted at on a chain with ledger-v8 history. The next
 *   hard fork adds a key (`v10`) rather than changing this shape, which is what lets an application's configuration
 *   outlive the fork.
 *
 *   Every entry is required and none is defaulted, for the same reason a single fork version was: where a chain forks is
 *   a fact about the chain rather than the SDK, and a wrong guess does not degrade — it decides which ledger version
 *   reads the chain.
 */
export type ForkSchedule = Readonly<{
  /** The protocol version from which ledger-v9 reads the chain. */
  v9: ProtocolVersion;
}>;

/**
 * The range of protocol versions on the same side of a protocol boundary as a given version.
 *
 * @remarks
 *   What the SDK means by "the same ledger version made these bytes". A protocol boundary divides the timeline into two
 *   epochs, and everything that routes on a version — which prover proves a transaction, which validator checks it,
 *   which variant may unwrap it — is really asking which epoch it belongs to. Stated once here so the two ends of that
 *   question, the wallet stamping a transaction and the caller unwrapping it, cannot compute the boundary differently.
 *
 *   A chain whose boundary is at or below the minimum supported version has never had two epochs, so the whole range is
 *   one.
 * @param version A version in the epoch of interest.
 * @param forkVersion The version at which the chain hands over to the next ledger version.
 * @returns The half-open range of versions in that epoch.
 */
export const epochOf = (version: ProtocolVersion, forkVersion: ProtocolVersion): ProtocolVersion.Range =>
  forkVersion <= MinSupportedVersion
    ? makeRange(MinSupportedVersion, MaxSupportedVersion)
    : version < forkVersion
      ? makeRange(MinSupportedVersion, forkVersion)
      : makeRange(forkVersion, MaxSupportedVersion);

/**
 * A value together with the protocol version range it serves.
 *
 * @typeParam T The type of the registered value.
 */
export type RegistryEntry<T> = Readonly<{ range: ProtocolVersion.Range; value: T }>;

/**
 * An ordered collection of values, each keyed by the protocol version range it serves.
 *
 * @remarks
 *   This is the shared shape behind every "which implementation speaks this protocol version?" question the SDK asks —
 *   which codec decodes a block, which prover proves a recipe, which transaction trait understands a pending
 *   transaction, which variant a snapshot should be restored into. Keeping one primitive means those answers cannot
 *   disagree about what a version range is or where its boundaries lie.
 *
 *   Entries are ascending and non-overlapping by construction, and ranges are half-open (`withinRange`), so exactly one
 *   entry can match a version. Gaps are allowed: a version no entry covers selects nothing, which callers turn into
 *   whichever typed error means "unsupported" in their domain.
 * @typeParam T The type of the registered values.
 */
export type Registry<T> = Readonly<{ entries: readonly RegistryEntry<T>[] }>;

/**
 * Raised when entries cannot form a {@link Registry} because their ranges are not ascending, overlap, or cannot be
 * closed at all.
 *
 * @remarks
 *   Construction is the only place this can happen: once built, a registry is total — selection returns an
 *   {@link Option.Option} rather than failing.
 */
export class RegistryError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-abstractions/ProtocolVersion/RegistryError',
)<{
  readonly message: string;
  /** The protocol versions whose ordering or overlap made the registry invalid. */
  readonly versions: readonly ProtocolVersion[];
}> {}

/** A registry with no entries: {@link select} on it never finds anything. */
export const emptyRegistry: Registry<never> = { entries: [] };

/**
 * Creates a registry from entries that already carry their own ranges.
 *
 * @param entries The entries, in ascending order of range start; ranges must not overlap, though gaps are allowed.
 * @returns The registry, or a {@link RegistryError} naming the two range boundaries that could not be ordered.
 */
export const makeRegistry = <T>(entries: readonly RegistryEntry<T>[]): Either.Either<Registry<T>, RegistryError> => {
  const brokenAt = entries.findIndex((entry, index) => index > 0 && entry.range[0] < entries[index - 1].range[1]);

  return brokenAt < 0
    ? Either.right({ entries })
    : Either.left(
        new RegistryError({
          message: 'Protocol version registry entries must be ascending and must not overlap.',
          versions: [entries[brokenAt - 1].range[1], entries[brokenAt].range[0]],
        }),
      );
};

/**
 * Creates a registry from values keyed by the protocol version each becomes active at, deriving the ranges from the
 * registration order: entry _i_ serves `[sinceVersion(i), sinceVersion(i + 1))`, and the last entry serves
 * `[sinceVersion(last), MaxSupportedVersion)`.
 *
 * @remarks
 *   This is the shape registration has everywhere in the SDK — a variant, codec or prover says which version it starts
 *   answering for, never which version it stops at — so the boundary between two of them is derived in exactly one
 *   place and cannot drift.
 * @param activations The values and the versions they activate at, in strictly ascending order.
 * @returns The registry, or a {@link RegistryError} naming the versions that broke the ordering.
 */
export const makeRegistryFromActivations = <T>(
  activations: readonly Readonly<{ sinceVersion: ProtocolVersion; value: T }>[],
): Either.Either<Registry<T>, RegistryError> => {
  const brokenAt = activations.findIndex(
    (activation, index) => index > 0 && activation.sinceVersion <= activations[index - 1].sinceVersion,
  );

  if (brokenAt >= 0) {
    return Either.left(
      new RegistryError({
        message: 'Protocol version activations must be strictly ascending.',
        versions: [activations[brokenAt - 1].sinceVersion, activations[brokenAt].sinceVersion],
      }),
    );
  }

  const last = activations.at(-1);
  if (last !== undefined && last.sinceVersion >= MaxSupportedVersion) {
    return Either.left(
      new RegistryError({
        message: 'A protocol version activation must leave room for a range above it.',
        versions: [last.sinceVersion],
      }),
    );
  }

  return Either.right({
    entries: activations.map(({ sinceVersion, value }, index) => ({
      range: makeRange(sinceVersion, activations[index + 1]?.sinceVersion ?? MaxSupportedVersion),
      value,
    })),
  });
};

/**
 * Finds the entry whose range contains a given protocol version.
 *
 * @param registry The {@link Registry} to search.
 * @param version The version to find an entry for.
 * @returns The matching entry, or `Option.none()` when no entry covers `version`.
 */
export const selectEntry = <T>(registry: Registry<T>, version: ProtocolVersion): Option.Option<RegistryEntry<T>> =>
  Option.fromNullable(registry.entries.find((entry) => withinRange(version, entry.range)));

/**
 * Finds the value whose range contains a given protocol version.
 *
 * @param registry The {@link Registry} to search.
 * @param version The version to find a value for.
 * @returns The matching value, or `Option.none()` when no entry covers `version`.
 */
export const select = <T>(registry: Registry<T>, version: ProtocolVersion): Option.Option<T> =>
  selectEntry(registry, version).pipe(Option.map((entry) => entry.value));
