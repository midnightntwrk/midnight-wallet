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
import { OtherWalletError, type WalletError } from './WalletError.js';
import { assertKeyAddressConsistency } from '../SchemeConsistency.js';
import { CoreWallet } from './CoreWallet.js';
import { SNAPSHOT_FORMAT_VERSION, upgradeSnapshotV1ToV2 } from '../SnapshotFormat.js';
// Re-exported because the version this variant writes is part of its serialization surface, as on the V1 twin.
export { SNAPSHOT_FORMAT_VERSION } from '../SnapshotFormat.js';
import { type NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedState } from './UnshieldedState.js';

export type SerializationCapability<TWallet, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(data: TSerialized): Either.Either<TWallet, WalletError>;
};

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
};

/**
 * The `version` field of an unshielded snapshot. A reader never downgrades: meeting a version it does not know, it
 * refuses the payload and names both the surface it was reading and the version it found, so the failure is actionable
 * without the reader having to parse a schema tree.
 *
 * This variant writes `v2`: its verifying key carries the signature scheme, where the V1 variant's is a bare string. A
 * retyped field is a new format version, so a `v1` payload is upgraded in one step before this schema sees it
 * (`upgradeSnapshotV1ToV2` in `../SnapshotFormat.ts`, which also holds both constants so the twins cannot drift). The
 * V1 variant never meets a `v2` snapshot: `../Restore.ts` routes each snapshot to the variant that owns its
 * `protocolVersion`.
 */
const SnapshotVersionSchema = Schema.Literal(SNAPSHOT_FORMAT_VERSION).annotations({
  message: (issue) =>
    `Refusing an unshielded snapshot written in format version ${JSON.stringify(issue.actual)}: this build reads ${SNAPSHOT_FORMAT_VERSION} and does not downgrade.`,
});

export const makeDefaultV2SerializationCapability = (): SerializationCapability<CoreWallet, string> => {
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

  const SnapshotSchema = Schema.Struct({
    version: Schema.optionalWith(SnapshotVersionSchema, {
      default: () => SNAPSHOT_FORMAT_VERSION,
    }),
    publicKey: Schema.Struct({
      // Tagged only: the bare-string key of a `v1` snapshot is tagged by the upgrade step before this schema runs.
      publicKey: SignatureVerifyingKeySchema,
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
        version: SNAPSHOT_FORMAT_VERSION,
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
        // Parse, upgrade, then decode: the upgrade step is a pure function on the JSON and runs before any schema, so
        // the schema describes exactly one shape and a `v1` payload arrives at it already in `v2`.
        Schema.decodeUnknownEither(Schema.parseJson(Schema.Unknown)),
        Either.map(upgradeSnapshotV1ToV2),
        Either.flatMap(Schema.decodeUnknownEither(SnapshotSchema)),
        Either.mapLeft((err) => new OtherWalletError(err)),
        // Enforce scheme consistency at the deserialization trust boundary: the
        // stored address must derive from the stored verifying key. This rejects
        // relabelled or spliced snapshots — a key whose encoding does not match
        // its scheme tag fails to decode (OtherWalletError), and a key/address
        // scheme mismatch is reported as a SchemeMismatchError.
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
