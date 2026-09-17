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
import { OtherWalletError, type WalletError } from './WalletError.js';
import { CoreWallet } from './CoreWallet.js';
import { type NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedState, UtxoWithMeta } from './UnshieldedState.js';

export type SerializationCapability<TWallet, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(data: TSerialized): Either.Either<TWallet, WalletError>;
};

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
};

/**
 * How long a booking restored from a snapshot that predates booking expiries is given, measured from the moment the
 * snapshot is loaded. It matches the transaction lifetime the facade hands out by default, so such a booking is bounded
 * exactly like one written by this version.
 */
export const LEGACY_BOOKING_LIFETIME_MS = 60 * 60 * 1000;

export const makeDefaultV1SerializationCapability = (): SerializationCapability<CoreWallet, string> => {
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
      default: () => new Date(Date.now() + LEGACY_BOOKING_LIFETIME_MS),
    }),
  });

  const SnapshotSchema = Schema.Struct({
    publicKey: Schema.Struct({
      publicKey: Schema.String,
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
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => new OtherWalletError(err)),
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
