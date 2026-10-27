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
import { Either, Schema } from 'effect';
import { isJsonObject, type UnknownFields, unknownFieldsOf } from './SnapshotFormat.js';
import {
  CURRENT_FORMAT_VERSION,
  TRANSACTION_HISTORY_SURFACE,
  UNRECOGNISED_FORMAT_VERSION,
  TransactionHistoryRestoreError,
  upgradeToCurrentFormat,
} from './TransactionHistoryFormat.js';
import {
  type TransactionHistoryStorage,
  type TransactionHash,
  type TransactionHistoryEntryCommon,
  type PendingEntryInput,
  type FinalizedEntryInput,
  type RejectedEntryInput,
  type SerializedTransactionHistory,
  coversTransaction,
} from './TransactionHistoryStorage.js';

/**
 * Parse a stored payload, turning a malformed one into the same failure as any other unreadable history.
 *
 * `JSON.parse` throws, and that throw is the only one here: it is caught at the boundary and turned into the `Left`
 * every other step in this path already speaks in, so no caller downstream has to know a throw was ever possible.
 */
const parseJson = (serialized: string): Either.Either<unknown, TransactionHistoryRestoreError> =>
  Either.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: (cause) =>
      new TransactionHistoryRestoreError({
        surface: TRANSACTION_HISTORY_SURFACE,
        reason: 'unparseable',
        detectedVersion: UNRECOGNISED_FORMAT_VERSION,
        cause,
      }),
  });

/**
 * The fields of a stored entry that the entry schema does not write back: every member of `raw` absent from `encoded`,
 * the same entry decoded and encoded again.
 *
 * Adding an optional field is not a format-version bump, so a history written by a later release carries a version this
 * build reads. Dropping what it cannot interpret would hand the later release back a history with the field gone.
 * Comparing against the schema's own round trip, rather than a list of declared names, keeps this right for any entry
 * schema a wallet extends the common one with.
 */
const entryUnknownFieldsOf = (raw: unknown, encoded: unknown): UnknownFields =>
  isJsonObject(raw) ? unknownFieldsOf(raw, (key) => isJsonObject(encoded) && Object.hasOwn(encoded, key)) : {};

/**
 * In-memory implementation of the TransactionHistoryStorage interface.
 *
 * `T` is the entry shape — a {@link TransactionHistoryEntryCommon} extension carrying any wallet-specific sections. The
 * reader returns `T` (with whichever lifecycle a given entry happens to be in); each writer method accepts a `T`-shaped
 * input minus its `lifecycle` field, and the storage attaches the appropriate lifecycle.
 *
 * An optional `merge` function controls how an incoming write combines with an existing entry under the same hash.
 * Default is a shallow spread (`{ ...existing, ...incoming }`).
 *
 * Because the merge runs **synchronously** inside the lifecycle methods, the single-threaded nature of JavaScript
 * guarantees atomicity — no external semaphore is needed.
 */
export class InMemoryTransactionHistoryStorage<
  T extends TransactionHistoryEntryCommon = TransactionHistoryEntryCommon,
  // `Encoded` is the schema's encoded-side type. It's a class generic (not an interface generic) because
  // `Schema.Schema<A, I>` is invariant in `I`, so the encoded form has to be inferred at construction time from the
  // schema argument. Callers don't usually supply this — TypeScript infers it from `schema`.
  Encoded = T,
> implements TransactionHistoryStorage<T> {
  #storage: Map<TransactionHash, T>;
  readonly #schema: Schema.Schema<T, Encoded>;
  readonly #merge: (existing: T, incoming: T) => T;
  // The envelope members a restored payload carried that this build does not write, written back with the next
  // serialize. Set once, by `tryRestore`, on the storage it has just built; empty for a storage built any other way,
  // and emptied by `reset`, since they described the history it discards.
  #envelopeUnknownFields: UnknownFields = {};
  // The fields each restored entry carried that the entry schema does not write, by hash, written back beside that
  // entry with the next serialize. Kept apart from the entry so no merge can drop them and none can reach a reader as
  // a decoded field; only entries that carried at least one have a bag here, and an entry's bag goes when it does.
  readonly #entryUnknownFields = new Map<TransactionHash, UnknownFields>();

  constructor(schema: Schema.Schema<T, Encoded>, merge?: (existing: T, incoming: T) => T) {
    this.#storage = new Map<TransactionHash, T>();
    this.#schema = schema;
    this.#merge = merge ?? ((existing, incoming) => ({ ...existing, ...incoming }));
  }

  async gotPending(input: PendingEntryInput<T>): Promise<void> {
    const { submittedAt, ...rest } = input;
    // Type cast required because: `T` is an open generic, so TypeScript cannot see that `Omit<T, 'lifecycle'>` plus a
    // `lifecycle` reconstitutes exactly `T`. The input type guarantees it — `PendingEntryInput<T>` is that `Omit` — but
    // the compiler has no rule that puts a spread of a generic's `Omit` back together.
    const entry = { ...rest, lifecycle: { status: 'pending', submittedAt } } as unknown as T;
    await this.#upsert(entry);
  }

  async gotFinalized(input: FinalizedEntryInput<T>): Promise<void> {
    const { finalizedBlock, ...rest } = input;
    // Type cast required because: `T` is an open generic, so TypeScript cannot see that `Omit<T, 'lifecycle'>` plus a
    // `lifecycle` reconstitutes exactly `T`. The input type guarantees it — `FinalizedEntryInput<T>` is that `Omit` —
    // but the compiler has no rule that puts a spread of a generic's `Omit` back together.
    const entry = { ...rest, lifecycle: { status: 'finalized', finalizedBlock } } as unknown as T;
    await this.#upsert(entry);
    this.#clearUnfinalizedCoveredBy(entry);
  }

  async gotRejected(input: RejectedEntryInput<T>): Promise<void> {
    if (this.#inclusionRecorded(input)) return;
    const { rejectedAt, reason, ...rest } = input;
    const lifecycle =
      reason !== undefined
        ? { status: 'rejected' as const, rejectedAt, reason }
        : { status: 'rejected' as const, rejectedAt };
    // Type cast required because: `T` is an open generic, so TypeScript cannot see that `Omit<T, 'lifecycle'>` plus a
    // `lifecycle` reconstitutes exactly `T`. The input type guarantees it — `RejectedEntryInput<T>` is that `Omit` —
    // but the compiler has no rule that puts a spread of a generic's `Omit` back together.
    const entry = { ...rest, lifecycle } as unknown as T;
    await this.#upsert(entry);
  }

  getAll(): Promise<readonly T[]> {
    return Promise.resolve([...this.#storage.values()]);
  }

  get(hash: TransactionHash): Promise<T | undefined> {
    return Promise.resolve(this.#storage.get(hash));
  }

  reset(): void {
    this.#storage.clear();
    this.#entryUnknownFields.clear();
    this.#envelopeUnknownFields = {};
  }

  serialize(): Promise<SerializedTransactionHistory> {
    const allEntries = [...this.#storage.values()];
    const encoded = Schema.encodeSync(Schema.Array(this.#schema))(allEntries);
    const entries = encoded.map((entry, index) => this.#withUnknownFields(entry, allEntries[index]?.hash));
    return Promise.resolve(
      JSON.stringify({ version: CURRENT_FORMAT_VERSION, entries, ...this.#envelopeUnknownFields }),
    );
  }

  /**
   * Rebuild a storage from a payload produced by {@link serialize}, in any format version this build knows.
   *
   * A payload is brought up to the current format before the entry schema sees it, so a history written by an older SDK
   * opens without the caller doing anything. A payload that cannot be read is refused with a
   * {@link TransactionHistoryRestoreError} rather than handed back as an empty storage — losing a history silently is
   * worse than failing to open it. This is {@link tryRestore} with the refusal thrown, the same pairing every wallet's
   * `restore` and `tryRestore` have.
   *
   * @example
   *   ```ts
   *   const restored = InMemoryTransactionHistoryStorage.restore(saved, WalletEntrySchema, mergeWalletEntries);
   *   ```;
   *
   * @param serialized - The stored payload.
   * @param schema - The full entry schema, including any wallet-specific sections.
   * @param merge - How an incoming write combines with an existing entry under the same hash.
   * @returns A storage holding every entry in the payload.
   * @throws TransactionHistoryRestoreError when the payload is not readable JSON, was written in a format version this
   *   build does not know, or does not decode against `schema` once upgraded. The error names the version the payload
   *   was actually read from, not the one this build writes, and says why in its `reason` and `message`.
   */
  static restore<T extends TransactionHistoryEntryCommon, Encoded>(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<T, Encoded>,
    merge?: (existing: T, incoming: T) => T,
  ): InMemoryTransactionHistoryStorage<T, Encoded> {
    return Either.getOrThrowWith(
      InMemoryTransactionHistoryStorage.tryRestore(serialized, schema, merge),
      (error) => error,
    );
  }

  /**
   * {@link restore}, reporting a refusal as a `Left` rather than throwing it.
   *
   * @example
   *   ```ts
   *   const restored = InMemoryTransactionHistoryStorage.tryRestore(saved, WalletEntrySchema, mergeWalletEntries);
   *   // Either.Either<InMemoryTransactionHistoryStorage<WalletEntry>, TransactionHistoryRestoreError>
   *   ```;
   *
   * @param serialized - The stored payload.
   * @param schema - The full entry schema, including any wallet-specific sections.
   * @param merge - How an incoming write combines with an existing entry under the same hash.
   * @returns A storage holding every entry in the payload, or a `Left` carrying the
   *   {@link TransactionHistoryRestoreError} that {@link restore} would throw.
   */
  static tryRestore<T extends TransactionHistoryEntryCommon, Encoded>(
    serialized: SerializedTransactionHistory,
    schema: Schema.Schema<T, Encoded>,
    merge?: (existing: T, incoming: T) => T,
  ): Either.Either<InMemoryTransactionHistoryStorage<T, Encoded>, TransactionHistoryRestoreError> {
    const entriesSchema = Schema.Array(schema);
    return parseJson(serialized).pipe(
      Either.flatMap(upgradeToCurrentFormat),
      Either.flatMap(({ version, entries, envelopeUnknownFields }) =>
        Schema.decodeUnknownEither(entriesSchema)(entries).pipe(
          Either.flatMap((values) =>
            Schema.encodeEither(entriesSchema)(values).pipe(Either.map((encoded) => ({ values, encoded }))),
          ),
          Either.mapLeft(
            (cause) =>
              new TransactionHistoryRestoreError({
                surface: TRANSACTION_HISTORY_SURFACE,
                reason: 'invalid-entries',
                detectedVersion: version,
                cause,
              }),
          ),
          Either.map(({ values, encoded }) => {
            // The array decode succeeded, so `entries` is an array aligned index for index with `values` and `encoded`.
            const rawEntries: readonly unknown[] = Array.isArray(entries) ? entries : [];
            const storage = new InMemoryTransactionHistoryStorage<T, Encoded>(schema, merge);
            values.forEach((entry) => storage.#storage.set(entry.hash, entry));
            values
              .map((entry, index) => [entry.hash, entryUnknownFieldsOf(rawEntries[index], encoded[index])] as const)
              .filter(([, unknownFields]) => Object.keys(unknownFields).length > 0)
              .forEach(([hash, unknownFields]) => storage.#entryUnknownFields.set(hash, unknownFields));
            storage.#envelopeUnknownFields = envelopeUnknownFields ?? {};
            return storage;
          }),
        ),
      ),
    );
  }

  #upsert(entry: T): Promise<void> {
    const existing = this.#storage.get(entry.hash);
    this.#storage.set(entry.hash, existing ? this.#merge(existing, entry) : entry);
    return Promise.resolve();
  }

  /** Checked synchronously with the write that follows, so a verdict racing sync cannot supersede inclusion. */
  #inclusionRecorded(key: Pick<T, 'hash' | 'identifiers'>): boolean {
    return [...this.#storage.values()].some(
      (entry) => entry.lifecycle.status === 'finalized' && coversTransaction(entry, key),
    );
  }

  #clearUnfinalizedCoveredBy(finalized: T): void {
    [...this.#storage.values()]
      .filter(
        (entry) =>
          entry.lifecycle.status !== 'finalized' &&
          entry.hash !== finalized.hash &&
          coversTransaction(finalized, entry),
      )
      .forEach((entry) => {
        this.#storage.delete(entry.hash);
        this.#entryUnknownFields.delete(entry.hash);
      });
  }

  /**
   * One encoded entry with the unknown fields its hash was restored with written beside it. A field the entry schema
   * wrote wins over a carried one of the same name, so a carried field never overwrites what this build encoded.
   */
  #withUnknownFields(encoded: unknown, hash: TransactionHash | undefined): unknown {
    const unknownFields = hash === undefined ? undefined : this.#entryUnknownFields.get(hash);
    return unknownFields === undefined || !isJsonObject(encoded)
      ? encoded
      : { ...encoded, ...unknownFieldsOf(unknownFields, (key) => Object.hasOwn(encoded, key)) };
  }
}
