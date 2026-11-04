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
import { SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnightntwrk/ledger-v9';
import { OtherWalletError, type WalletError } from './WalletError.js';
import { CoreWallet } from './CoreWallet.js';
import {
  PendingDustSchema,
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_FORMAT_VERSIONS,
  upgradeSnapshotV1ToV2,
} from '../SnapshotFormat.js';
// Re-exported because the version this variant writes is part of its serialization surface, as on the V1 twin.
export { SNAPSHOT_FORMAT_VERSION } from '../SnapshotFormat.js';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError>;
};

const StateSchema = Schema.declare(
  (input: unknown): input is ledger.DustLocalState => input instanceof ledger.DustLocalState,
).annotations({
  identifier: 'ledger.DustLocalState',
});

export const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const StateFromUInt8Array: Schema.Schema<ledger.DustLocalState, Uint8Array> = Schema.asSchema(
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
        try: () => ledger.DustLocalState.deserialize(bytes),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize local state');
        },
      }),
  }),
);

const HexedState: Schema.Schema<ledger.DustLocalState, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(StateFromUInt8Array),
);

const SnapshotSchema = Schema.Struct({
  // The version names the snapshot's shape, not the variant that wrote it, and the constants live in
  // `../SnapshotFormat.ts` so the twins cannot drift apart. Both variants write this shape; a `v1` payload is upgraded
  // in one step before this schema sees it (`upgradeSnapshotV1ToV2`).
  version: SnapshotFormat.versionField('dust', SNAPSHOT_FORMAT_VERSION),
  writtenBy: SnapshotFormat.writtenByField(),
  publicKey: Schema.Struct({
    publicKey: Schema.BigInt,
  }),
  state: HexedState,
  protocolVersion: Schema.BigInt,
  networkId: Schema.String,
  offset: Schema.optional(Schema.BigInt),
  pendingDust: Schema.Array(PendingDustSchema),
});

type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;

export const makeDefaultV2SerializationCapability = (): SerializationCapability<CoreWallet, null, string> => {
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: CoreWallet): Snapshot => ({
        version: SNAPSHOT_FORMAT_VERSION,
        writtenBy: SnapshotFormat.V2_SNAPSHOT_WRITER,
        publicKey: w.publicKey,
        state: w.state,
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        offset: w.progress?.appliedIndex,
        pendingDust: w.pendingDust,
      });

      return SnapshotFormat.writeSnapshot(SnapshotSchema, buildSnapshot(wallet), wallet.unknownFields);
    },
    deserialize: (aux, serialized): Either.Either<CoreWallet, WalletError> => {
      return pipe(
        serialized,
        SnapshotFormat.readSnapshotWithUnknownFields({
          surface: 'dust',
          reads: SNAPSHOT_FORMAT_VERSIONS,
          schema: SnapshotSchema,
          upgrade: upgradeSnapshotV1ToV2,
        }),
        Either.flatMap(({ snapshot, unknownFields }) =>
          Either.try({
            try: () =>
              SnapshotFormat.withUnknownFields(
                CoreWallet.restore(
                  snapshot.state,
                  snapshot.publicKey,
                  [...snapshot.pendingDust],
                  {
                    appliedIndex: snapshot.offset ?? 0n,
                    highestRelevantWalletIndex: 0n,
                    highestIndex: 0n,
                    highestRelevantIndex: 0n,
                  },
                  snapshot.protocolVersion,
                  snapshot.networkId,
                ),
                unknownFields,
              ),
            catch: (err) => new OtherWalletError({ message: 'Error while restoring core wallet', cause: err }),
          }),
        ),
      );
    },
  };
};
