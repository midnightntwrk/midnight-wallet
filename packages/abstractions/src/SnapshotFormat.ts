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
import { Data, Either, Schema } from 'effect';

const article = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/**
 * The `version` field of a wallet snapshot, for the one format version a reader accepts.
 *
 * A reader never downgrades: meeting a version it does not know, it refuses the payload and names both the surface it
 * was reading and the version it found, so the failure is actionable without the reader having to parse a schema tree.
 * A payload with no `version` at all predates the field and reads as the version given, because every surface's first
 * labelled shape is the shape it always had.
 *
 * Every snapshot surface declares its field through this one function, so the refusal reads the same on all of them and
 * the rule lives in one place.
 *
 * @example
 *   ```ts
 *   const SnapshotSchema = Schema.Struct({
 *     version: SnapshotFormat.versionField('shielded', SNAPSHOT_FORMAT_VERSION),
 *     // ...
 *   });
 *   ```;
 *
 * @param surface - The snapshot surface, as a noun for the refusal message: `shielded`, `unshielded` or `dust`.
 * @param version - The one format version this reader accepts, and writes when the field is absent.
 * @returns An optional property signature that defaults to `version` and refuses any other value by name.
 */
export const versionField = <const V extends string>(
  surface: string,
  version: V,
): Schema.optionalWith<Schema.Literal<[V]>, { readonly default: () => V }> =>
  Schema.optionalWith(
    Schema.Literal(version).annotations({
      message: (issue) =>
        `Refusing ${article(surface)} ${surface} snapshot written in format version ${JSON.stringify(issue.actual)}: this build reads ${version} and does not downgrade.`,
    }),
    { default: () => version },
  );

/**
 * The variants that write wallet snapshots, by the ordinal each carries in its name: the V1 variant on ledger-v8 and
 * the V2 variant on ledger-v9.
 */
export const SNAPSHOT_WRITERS = ['v1', 'v2'] as const;

/** Which variant wrote a snapshot. */
export type SnapshotWriter = (typeof SNAPSHOT_WRITERS)[number];

/** The V1 variant, as it names itself in a snapshot it writes. */
export const V1_SNAPSHOT_WRITER = 'v1' satisfies SnapshotWriter;

/** The V2 variant, as it names itself in a snapshot it writes. */
export const V2_SNAPSHOT_WRITER = 'v2' satisfies SnapshotWriter;

/**
 * Whether a value names a variant this build knows as a snapshot writer.
 *
 * @remarks
 *   This is where the known writers are narrowed, and the only place: {@link writtenByField} accepts any name so that a
 *   later variant's snapshot still reads, and routing uses this guard to decide whether the name is one it can send the
 *   snapshot home to. A name it does not know is treated as no name at all, and the version routes the snapshot.
 * @param value The value found under `writtenBy`, or anything else.
 * @returns Whether the value is one of {@link SNAPSHOT_WRITERS}.
 */
export const isSnapshotWriter: (value: unknown) => value is SnapshotWriter = Schema.is(
  Schema.Literal(...SNAPSHOT_WRITERS),
);

/**
 * The `writtenBy` field of a wallet snapshot: which variant wrote it.
 *
 * A format version names a snapshot's shape, and the `protocolVersion` inside it names the chain's version when it was
 * written. Neither says who wrote it, and the wallet layer needs that to route a snapshot home: a V1 wallet that has
 * seen the chain reach `forks.v9` annotates that version before the runtime hands it over, so a snapshot it writes in
 * that window carries a version the V2 variant owns. Read as a V2 snapshot it would skip the cross-ledger migration;
 * routed to the variant that wrote it, it crosses like any other.
 *
 * Optional, because every snapshot written before the field existed lacks it, and those keep routing by version. Any
 * string, not only the writers this build knows, because the writer is a routing hint and not part of the shape: a
 * later variant that keeps a format this build reads names itself here, and refusing on the name would turn "add a
 * variant" into a format bump for every older reader. Routing narrows the name with {@link isSnapshotWriter}.
 *
 * @returns An optional property signature over the writer's name.
 */
export const writtenByField = (): Schema.optional<typeof Schema.String> => Schema.optional(Schema.String);

/**
 * Which of the ways a snapshot restore can fail a {@link SnapshotRestoreError} reports, so an application can tell
 * "written by a newer SDK" from "corrupt" without reading the message.
 *
 * - `unparseable` — the stored string is not JSON.
 * - `unrecognised` — JSON, but not an object, so not a snapshot of any version.
 * - `unknown-version` — the snapshot declares a format version this reader does not read; most likely a newer SDK wrote
 *   it, and a reader never downgrades. A `version` that is not even a string is reported here too, named as found.
 * - `invalid-shape` — a version this reader reads, whose contents fail the snapshot schema once upgraded.
 */
export type SnapshotRestoreReason = 'unparseable' | 'unrecognised' | 'unknown-version' | 'invalid-shape';

/** What the error was constructed from; the message is derived, not supplied. */
type SnapshotRestoreFacts = {
  /** The snapshot surface that failed: `shielded`, `unshielded` or `dust`. */
  readonly surface: string;
  /** Which way the restore failed. */
  readonly reason: SnapshotRestoreReason;
  /** The format version the snapshot declared, what an unlabelled one means, or `unrecognised` for no JSON at all. */
  readonly detectedVersion: string;
  /** The underlying failure — a `ParseError` from the schema, or a thrown value from `JSON.parse`. */
  readonly cause: unknown;
};

const describeCause = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * Raised when a stored wallet snapshot cannot be read by the variant it was handed to.
 *
 * Carries the surface, the version detected, the reason and the cause as fields, and says all four in its `message`, so
 * a log line or `String(error)` is enough to act on. The counterpart of the transaction history's
 * `TransactionHistoryRestoreError`, so every persisted surface refuses the same way.
 */
export class SnapshotRestoreError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-abstractions/SnapshotFormat/SnapshotRestoreError',
)<SnapshotRestoreFacts & { readonly message: string }> {
  constructor(facts: SnapshotRestoreFacts) {
    super({
      ...facts,
      message: `Could not restore the ${facts.surface} snapshot (format ${facts.detectedVersion}, ${facts.reason}): ${describeCause(facts.cause)}`,
    });
  }
}

const isRecord = Schema.is(Schema.Record({ key: Schema.String, value: Schema.Unknown }));

/**
 * Reads a serialized snapshot into its decoded shape, refusing with a {@link SnapshotRestoreError} that says why.
 *
 * The one reader every snapshot surface goes through: it parses the JSON, checks the format version the payload
 * declares against the versions this reader accepts, runs the upgrade step when the payload is in an older accepted
 * version, and decodes the schema. A snapshot that declares no version is read as the oldest accepted one, because
 * every surface's first labelled shape is the shape it always had.
 *
 * The refusal names what was actually found: JSON that is not an object is `unrecognised`, a `version` that is present
 * but not a string is reported as an unknown version by its JSON text, and only a string version this reader accepts
 * reaches the schema. Nothing is silently read as the oldest version except a payload that declares none.
 *
 * @example
 *   ```ts
 *   const read = SnapshotFormat.readSnapshot({ surface: 'shielded', reads: ['v1'], schema: SnapshotSchema });
 *   read(serialized); // Either.Either<Snapshot, SnapshotRestoreError>
 *   ```;
 *
 * @param options - `surface` names the snapshot for the refusal; `reads` lists the versions this reader accepts, oldest
 *   first; `schema` is the shape of the newest of them; `upgrade`, when given, is the pure step that brings an older
 *   accepted version's JSON to that shape before the schema runs. It is not run on a payload already in the newest
 *   version, so the reader does not lean on the step being idempotent.
 * @returns A reader from the stored string to the decoded snapshot, or the refusal.
 */
export const readSnapshot =
  <A, I>(options: {
    readonly surface: string;
    readonly reads: readonly [string, ...string[]];
    readonly schema: Schema.Schema<A, I>;
    readonly upgrade?: (json: unknown) => unknown;
  }) =>
  (serialized: string): Either.Either<A, SnapshotRestoreError> => {
    const { surface, reads, schema } = options;
    const upgrade = options.upgrade ?? ((json: unknown): unknown => json);
    const current = reads[reads.length - 1] ?? reads[0];
    const unknownVersion = (detectedVersion: string): SnapshotRestoreError =>
      new SnapshotRestoreError({
        surface,
        reason: 'unknown-version',
        detectedVersion,
        cause: new Error(
          `Refusing ${article(surface)} ${surface} snapshot written in format version ${JSON.stringify(detectedVersion)}: this build reads ${current} and does not downgrade.`,
        ),
      });
    const decodeAs = (declared: string, json: Record<string, unknown>): Either.Either<A, SnapshotRestoreError> =>
      Schema.decodeUnknownEither(schema)(declared === current ? json : upgrade(json)).pipe(
        Either.mapLeft(
          (cause) => new SnapshotRestoreError({ surface, reason: 'invalid-shape', detectedVersion: declared, cause }),
        ),
      );
    return Either.try({
      try: () => JSON.parse(serialized) as unknown,
      catch: (cause) =>
        new SnapshotRestoreError({ surface, reason: 'unparseable', detectedVersion: 'unrecognised', cause }),
    }).pipe(
      Either.flatMap((json) =>
        isRecord(json)
          ? Either.right(json)
          : Either.left(
              new SnapshotRestoreError({
                surface,
                reason: 'unrecognised',
                detectedVersion: 'unrecognised',
                cause: new Error(
                  `Expected ${article(surface)} ${surface} snapshot object, found ${JSON.stringify(json)}.`,
                ),
              }),
            ),
      ),
      Either.flatMap((json) => {
        const version = json['version'];
        return version === undefined
          ? decodeAs(reads[0], json)
          : typeof version !== 'string'
            ? Either.left(unknownVersion(JSON.stringify(version)))
            : reads.includes(version)
              ? decodeAs(version, json)
              : Either.left(unknownVersion(version));
      }),
    );
  };
