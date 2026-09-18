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
import { addressFromKey } from '@midnight-ntwrk/ledger-v8';
import { OtherWalletError, type WalletError } from './WalletError.js';
import { CoreWallet } from './CoreWallet.js';
import { type PublicKey } from './KeyStore.js';
import { type NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedState } from './UnshieldedState.js';

export type SerializationCapability<TWallet, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(data: TSerialized): Either.Either<TWallet, WalletError>;
};

/**
 * Asserts that a {@link PublicKey}'s stored address was really derived from its stored verifying key.
 *
 * @remarks
 *   Deserialization is a trust boundary — a snapshot is whatever was handed back to the wallet — and the schema alone
 *   cannot catch a spliced key/address pair, since both fields are well-formed strings either way. Deriving one from
 *   the other is what shows they belong together. Deriving also exercises the ledger's key decoder, which traps in wasm
 *   on a malformed key, so the call is wrapped and the boundary fails closed with a typed error rather than letting an
 *   exception escape.
 *
 *   The ledger-v9 variant makes the same assertion but reports a mismatch as a `SchemeMismatchError`, naming the
 *   signature scheme the address must have been derived under. Ledger-v8 has a single scheme, so there is no scheme to
 *   name and the mismatch is an ordinary wallet error.
 * @param publicKey - The public-key bundle read out of a snapshot.
 * @returns `Right(publicKey)` when the address matches the key; otherwise `Left(OtherWalletError)`.
 */
export const assertKeyAddressConsistency = (publicKey: PublicKey): Either.Either<PublicKey, WalletError> =>
  pipe(
    Either.try({
      try: () => addressFromKey(publicKey.publicKey),
      catch: (cause) => new OtherWalletError({ message: 'Unshielded verifying key could not be decoded.', cause }),
    }),
    Either.flatMap((derivedAddress): Either.Either<PublicKey, WalletError> =>
      derivedAddress === publicKey.addressHex
        ? Either.right(publicKey)
        : Either.left(
            new OtherWalletError({
              message: 'Unshielded address does not match its verifying key.',
            }),
          ),
    ),
  );

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
};

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

  const SnapshotSchema = Schema.Struct({
    publicKey: Schema.Struct({
      publicKey: Schema.String,
      addressHex: Schema.String,
      address: Schema.String,
    }),
    state: Schema.Struct({
      availableUtxos: Schema.Array(UtxoWithMetaSchema),
      pendingUtxos: Schema.Array(UtxoWithMetaSchema),
    }),
    protocolVersion: Schema.BigInt,
    appliedId: Schema.optional(Schema.BigInt),
    networkId: Schema.String,
  });

  type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: CoreWallet): Snapshot => ({
        publicKey: w.publicKey,
        state: UnshieldedState.toArrays(w.state),
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        appliedId: w.progress?.appliedId,
      });

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (serialized): Either.Either<CoreWallet, WalletError> =>
      pipe(
        serialized,
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => new OtherWalletError(err)),
        // The schema proves the snapshot's shape; this proves its key and address belong to each other.
        Either.flatMap((snapshot) =>
          pipe(
            assertKeyAddressConsistency(snapshot.publicKey),
            Either.map(() => snapshot),
          ),
        ),
        Either.map((snapshot) => {
          return CoreWallet.restore(
            UnshieldedState.restore(snapshot.state.availableUtxos, snapshot.state.pendingUtxos),
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
