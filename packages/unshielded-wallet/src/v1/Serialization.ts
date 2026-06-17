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
import { type SignatureKind } from '@midnight-ntwrk/ledger-v9';
import { OtherWalletError, type WalletError } from './WalletError.js';
import { assertKeyAddressConsistency, assertKeyTagConsistency } from '../SchemeConsistency.js';
import { CoreWallet } from './CoreWallet.js';
import { type NetworkId, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { UnshieldedState } from './UnshieldedState.js';

export type SerializationCapability<TWallet, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(data: TSerialized): Either.Either<TWallet, WalletError>;
};

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
};

export const makeDefaultV1SerializationCapability = (): SerializationCapability<CoreWallet, string> => {
  // Annotated with the ledger type so this fails to typecheck if SignatureKind gains or loses members
  const SignatureKindSchema: Schema.Schema<SignatureKind> = Schema.Literal('schnorr', 'ecdsa');

  const SignatureVerifyingKeySchema = Schema.Struct({
    tag: SignatureKindSchema,
    value: Schema.String,
  });

  // Legacy (ledger-v8) snapshots stored the verifying key as a plain string, which was implicitly schnorr
  const LegacySignatureVerifyingKeySchema = Schema.transform(
    Schema.String,
    Schema.typeSchema(SignatureVerifyingKeySchema),
    {
      strict: true,
      decode: (value) => ({ tag: 'schnorr' as const, value }),
      encode: ({ value }) => value,
    },
  );

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
      // Tagged form first so encoding always writes the tag; the legacy member only matches string inputs on decode
      publicKey: Schema.Union(SignatureVerifyingKeySchema, LegacySignatureVerifyingKeySchema),
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
        // Enforce the scheme tag at the deserialization trust boundary: the
        // verifying key's encoding must match its tag, and the stored address
        // must derive from that key. Rejects relabelled or spliced snapshots.
        Either.flatMap((snapshot) =>
          pipe(
            assertKeyTagConsistency(snapshot.publicKey.publicKey),
            Either.flatMap(() => assertKeyAddressConsistency(snapshot.publicKey)),
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
