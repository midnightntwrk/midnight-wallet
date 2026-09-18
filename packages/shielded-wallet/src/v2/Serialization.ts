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
import { Effect, ParseResult, Either, pipe, Schema } from 'effect';
import { WalletError } from './WalletError.js';
import * as ledger from '@midnightntwrk/ledger-v9';
import { CoreWallet } from './CoreWallet.js';
import { SNAPSHOT_FORMAT_VERSION } from '../SnapshotFormat.js';
// Re-exported because the version this variant writes is part of its serialization surface, as on the V1 twin.
export { SNAPSHOT_FORMAT_VERSION } from '../SnapshotFormat.js';
import { type NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError>;
};

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
};

const StateSchema = Schema.declare(
  (input: unknown): input is ledger.ZswapLocalState => input instanceof ledger.ZswapLocalState,
).annotations({
  identifier: 'ledger.ZswapLocalState',
});

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const StateFromUInt8Array = (): Schema.Schema<ledger.ZswapLocalState, Uint8Array> =>
  Schema.asSchema(
    Schema.transformOrFail(Uint8ArraySchema, StateSchema, {
      encode: (state) => {
        return Effect.try({
          try: () => {
            return state.serialize();
          },
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not serialize local state');
          },
        });
      },
      decode: (bytes) =>
        Effect.try({
          try: () => ledger.ZswapLocalState.deserialize(bytes),
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not deserialize local state');
          },
        }),
    }),
  );

const HexedState = (): Schema.Schema<ledger.ZswapLocalState, string> =>
  pipe(Schema.Uint8ArrayFromHex, Schema.compose(StateFromUInt8Array()));

/**
 * The `version` field of a shielded snapshot. A reader never downgrades: meeting a version it does not know, it refuses
 * the payload and names both the surface it was reading and the version it found, so the failure is actionable without
 * the reader having to parse a schema tree.
 *
 * The version names the snapshot's shape, not the variant that wrote it, and the constant lives in
 * `../SnapshotFormat.ts` so the twins cannot drift apart. Both variants write this shape — the V2 variant adds only
 * optional fields to it, which is not a new version. A V1 reader never meets a V2 snapshot anyway: `../Restore.ts`
 * routes each snapshot to the variant that owns its `protocolVersion`.
 */
const SnapshotVersionSchema = Schema.Literal(SNAPSHOT_FORMAT_VERSION).annotations({
  message: (issue) =>
    `Refusing a shielded snapshot written in format version ${JSON.stringify(issue.actual)}: this build reads ${SNAPSHOT_FORMAT_VERSION} and does not downgrade.`,
});

export const makeDefaultV2SerializationCapability = (): SerializationCapability<CoreWallet, null, string> => {
  const SnapshotSchema = Schema.Struct({
    version: Schema.optionalWith(SnapshotVersionSchema, {
      default: () => SNAPSHOT_FORMAT_VERSION,
    }),
    publicKeys: Schema.Struct({
      coinPublicKey: Schema.String,
      encryptionPublicKey: Schema.String,
    }),
    state: HexedState(),
    protocolVersion: Schema.BigInt,
    offset: Schema.optional(Schema.BigInt),
    networkId: Schema.String,
    coinHashes: Schema.Record({
      key: Schema.String,
      value: Schema.Struct({ nullifier: Schema.String, commitment: Schema.String }),
    }),
    // Set only on a wallet caught between a cross-ledger migration and its first sync update: its state crossed the
    // boundary as bytes, but the hashes over that state need secret keys nobody here has (see
    // `CoreWallet.coinHashesPending`). Optional twice over — a wallet that is not mid-crossing has nothing to declare,
    // and snapshots written before the field existed must keep decoding unchanged.
    coinHashesPending: Schema.optional(Schema.Literal(true)),
    // The transaction history a 1.0.0 snapshot embedded. Read back and written out untouched, never added to; absent
    // for every snapshot written since, and kept absent for them. See `CoreWallet.legacyTxHistory`.
    txHistory: Schema.optional(Schema.Array(Schema.String)),
  });

  type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: CoreWallet): Snapshot => ({
        version: SNAPSHOT_FORMAT_VERSION,
        publicKeys: w.publicKeys,
        state: w.state,
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        offset: w.progress?.appliedIndex,
        coinHashes: w.coinHashes,
        ...(w.coinHashesPending !== undefined ? { coinHashesPending: w.coinHashesPending } : {}),
        txHistory: w.legacyTxHistory,
      });

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (aux, serialized): Either.Either<CoreWallet, WalletError> => {
      return pipe(
        serialized,
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => WalletError.other(err)),
        Either.flatMap((snapshot: Snapshot) => {
          const progress = {
            appliedIndex: snapshot.offset ?? 0n,
            highestRelevantWalletIndex: 0n,
            highestIndex: 0n,
            highestRelevantIndex: 0n,
            isConnected: false,
          };

          // A snapshot that declares its hashes pending is the one shape the validation below would wrongly refuse:
          // its state is full and its hash map is empty by construction, because the migration that wrote it had no
          // secret keys. Every other snapshot goes on being checked against its own state.
          return snapshot.coinHashesPending === true
            ? Either.right(
                CoreWallet.restoreWithPendingCoinHashes(
                  snapshot.publicKeys,
                  snapshot.state,
                  progress,
                  snapshot.protocolVersion,
                  snapshot.networkId,
                  snapshot.txHistory,
                ),
              )
            : CoreWallet.restoreWithCoinHashes(
                snapshot.publicKeys,
                snapshot.state,
                snapshot.coinHashes,
                progress,
                snapshot.protocolVersion,
                snapshot.networkId,
                snapshot.txHistory,
              );
        }),
      );
    },
  };
};
