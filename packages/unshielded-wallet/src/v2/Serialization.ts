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
import { Either, pipe, Schema } from 'effect';
import { type SignatureKind } from '@midnightntwrk/ledger-v9';
import { type WalletError } from './WalletError.js';
import { assertKeyAddressConsistency } from '../SchemeConsistency.js';
import { CoreWallet } from './CoreWallet.js';
import { SNAPSHOT_FORMAT_VERSION, V1_SNAPSHOT_FORMAT_VERSION, upgradeSnapshotV1ToV2 } from '../SnapshotFormat.js';
// Re-exported because the version this variant writes is part of its serialization surface, as on the V1 twin.
export { SNAPSHOT_FORMAT_VERSION } from '../SnapshotFormat.js';
import { type NetworkId, ProtocolVersion, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { UnshieldedState, UtxoWithMeta } from './UnshieldedState.js';

export type SerializationCapability<TWallet, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(data: TSerialized): Either.Either<TWallet, WalletError>;
};

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
  /**
   * The clock a booking restored without an expiry is dated from. Defaults to system time; inject one to make what a
   * snapshot reads back deterministic, as the format drift tests do.
   */
  clock?: Clock.Clock;
};

/**
 * How long a booking restored from a snapshot that predates booking expiries is given, measured from the moment the
 * snapshot is loaded. It matches the transaction lifetime the facade hands out by default, so such a booking is bounded
 * exactly like one written by this version.
 */
export const LEGACY_BOOKING_LIFETIME_MS = 60 * 60 * 1000;

export const makeDefaultV2SerializationCapability = ({
  clock = Clock.systemClock,
}: Pick<DefaultSerializationConfiguration, 'clock'> = {}): SerializationCapability<CoreWallet, string> => {
  // Annotated with the ledger type so this fails to typecheck if SignatureKind gains or loses members
  const SignatureKindSchema: Schema.Schema<SignatureKind> = Schema.Literal('schnorr', 'ecdsa');

  const SignatureVerifyingKeySchema = Schema.Struct({
    tag: SignatureKindSchema,
    value: Schema.String,
  });

  const UtxoWithMetaSchema = Schema.Struct({
    utxo: Schema.Struct({
      value: Schema.BigInt,
      owner: Schema.String,
      type: Schema.String,
      intentHash: Schema.String,
      outputNo: Schema.Number,
    }),
    meta: Schema.Struct({
      ctime: Schema.Date,
      registeredForDustGeneration: Schema.Boolean,
    }),
  });

  /**
   * A pending entry is a UTxO plus the expiry its booking was taken with. `ttl` is additive: a snapshot written before
   * bookings carried an expiry has no expiry to restore, so one is granted from the moment it is loaded.
   *
   * Granted rather than assumed to have passed, because such a snapshot says nothing about when its coins were booked.
   * The process that wrote it may have submitted the transaction moments before it stopped, and dating the booking in
   * the past would offer a coin that transaction is still spending. A full lifetime ahead releases the coin only once
   * no transaction could still be accepted, which is the bound every other booking already has.
   */
  const PendingUtxoSchema = Schema.Struct({
    ...UtxoWithMetaSchema.fields,
    ttl: Schema.optionalWith(Schema.Date, {
      default: () => new Date(clock.now().getTime() + LEGACY_BOOKING_LIFETIME_MS),
    }),
  });

  const SnapshotSchema = Schema.Struct({
    // This variant writes `v2`: its verifying key carries the signature scheme, where the V1 variant's is a bare
    // string. A retyped field is a new format version, so a `v1` payload is upgraded in one step before this schema
    // sees it (`upgradeSnapshotV1ToV2` in `../SnapshotFormat.ts`, which also holds both constants so the twins cannot
    // drift). The V1 variant never meets a `v2` snapshot: `../Restore.ts` routes each snapshot to the variant it
    // names as its writer — for unshielded, a bare-string key names V1 — and by the variant that owns its
    // `protocolVersion` when it names none.
    version: SnapshotFormat.versionField('unshielded', SNAPSHOT_FORMAT_VERSION),
    writtenBy: SnapshotFormat.writtenByField(),
    publicKey: Schema.Struct({
      // Tagged only: the bare-string key of a `v1` snapshot is tagged by the upgrade step before this schema runs.
      publicKey: SignatureVerifyingKeySchema,
      addressHex: Schema.String,
      address: Schema.String,
    }),
    state: Schema.Struct({
      availableUtxos: Schema.Array(UtxoWithMetaSchema),
      pendingUtxos: Schema.Array(PendingUtxoSchema),
    }),
    protocolVersion: Schema.BigInt,
    appliedId: Schema.optional(Schema.BigInt),
    networkId: Schema.String,
  });

  type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: CoreWallet): Snapshot => {
        const { availableUtxos, pendingUtxos } = UnshieldedState.toArrays(w.state);

        return {
          version: SNAPSHOT_FORMAT_VERSION,
          writtenBy: SnapshotFormat.V2_SNAPSHOT_WRITER,
          publicKey: w.publicKey,
          state: {
            availableUtxos,
            // The snapshot keeps one flat record per pending coin, with its booking's expiry alongside its meta.
            pendingUtxos: pendingUtxos.map(({ utxo, ttl }) => ({ utxo: utxo.utxo, meta: utxo.meta, ttl })),
          },
          protocolVersion: w.protocolVersion,
          networkId: w.networkId,
          appliedId: w.progress?.appliedId,
        };
      };

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (serialized): Either.Either<CoreWallet, WalletError> =>
      pipe(
        serialized,
        // Parse, upgrade, then decode: the upgrade step is a pure function on the JSON and runs before any schema, so
        // the schema describes exactly one shape and a `v1` payload arrives at it already in `v2`.
        SnapshotFormat.readSnapshot({
          surface: 'unshielded',
          reads: [V1_SNAPSHOT_FORMAT_VERSION, SNAPSHOT_FORMAT_VERSION],
          schema: SnapshotSchema,
          upgrade: upgradeSnapshotV1ToV2,
        }),
        // Enforce scheme consistency at the deserialization trust boundary: the
        // stored address must derive from the stored verifying key. This rejects
        // relabelled or spliced snapshots — a key whose encoding does not match
        // its scheme tag fails to decode (SnapshotRestoreError), and a key/address
        // scheme mismatch is reported as a SchemeMismatchError.
        Either.flatMap((snapshot) =>
          pipe(
            assertKeyAddressConsistency(snapshot.publicKey),
            Either.map(() => snapshot),
          ),
        ),
        Either.map((snapshot) => {
          return CoreWallet.restore(
            UnshieldedState.restore(
              snapshot.state.availableUtxos,
              snapshot.state.pendingUtxos.map(({ utxo, meta, ttl }) => ({
                utxo: new UtxoWithMeta({ utxo, meta }),
                ttl,
              })),
            ),
            snapshot.publicKey,
            {
              highestTransactionId: snapshot.appliedId ?? 0n,
              appliedId: snapshot.appliedId ?? 0n,
            },
            ProtocolVersion.ProtocolVersion(snapshot.protocolVersion),
            snapshot.networkId,
          );
        }),
      ),
  };
};
