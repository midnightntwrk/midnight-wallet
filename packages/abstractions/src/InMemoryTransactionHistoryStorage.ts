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
import { Either, Record as ERecord, Schema } from 'effect';
import { type UnknownFields } from './SnapshotFormat.js';
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

/** The members of a stored envelope other than the two this build writes; a bare `v1` array has none. */
const envelopeUnknownFieldsOf = (payload: unknown): UnknownFields =>
  isJsonObject(payload) ? ERecord.filter(payload, (_, key) => key !== 'version' && key !== 'entries') : {};

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read and write entries keeping every field the entry schema does not declare.
 *
 * Adding an optional field is not a format-version bump, so a history written by a later release carries a version this
 * build reads. Dropping what it cannot interpret would hand the later release back a history with the field gone;
 * keeping it costs nothing, because an entry is written back from the value it was read into.
 */
const keepUnknownFields = { onExcessProperty: 'preserve' } as const;

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
  // serialize. Set once, by `tryRestore`, on the storage it has just built; empty for a storage built any other way.
  #envelopeUnknownFields: UnknownFields = {};

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
  }

  serialize(): Promise<SerializedTransactionHistory> {
    const allEntries = [...this.#storage.values()];
    const encode = Schema.encodeSync(Schema.Array(this.#schema), keepUnknownFields);
    return Promise.resolve(
      JSON.stringify({ version: CURRENT_FORMAT_VERSION, entries: encode(allEntries), ...this.#envelopeUnknownFields }),
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
    return parseJson(serialized).pipe(
      Either.flatMap((payload) =>
        upgradeToCurrentFormat(payload).pipe(
          Either.map((upgraded) => ({ ...upgraded, envelopeUnknownFields: envelopeUnknownFieldsOf(payload) })),
        ),
      ),
      Either.flatMap(({ version, entries, envelopeUnknownFields }) =>
        Schema.decodeUnknownEither(
          Schema.Array(schema),
          keepUnknownFields,
        )(entries).pipe(
          Either.mapLeft(
            (cause) =>
              new TransactionHistoryRestoreError({
                surface: TRANSACTION_HISTORY_SURFACE,
                reason: 'invalid-entries',
                detectedVersion: version,
                cause,
              }),
          ),
          Either.map((values) => ({ values, envelopeUnknownFields })),
        ),
      ),
      Either.map(({ values, envelopeUnknownFields }) => {
        const storage = new InMemoryTransactionHistoryStorage<T, Encoded>(schema, merge);
        values.forEach((entry) => storage.#storage.set(entry.hash, entry));
        storage.#envelopeUnknownFields = envelopeUnknownFields;
        return storage;
      }),
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
      .forEach((entry) => this.#storage.delete(entry.hash));
  }
}
