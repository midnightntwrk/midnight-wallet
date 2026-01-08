// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { DustCoreWallet } from './DustCoreWallet.js';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError.WalletError>;
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
  publicKey: Schema.Struct({
    publicKey: Schema.BigInt,
  }),
  state: HexedState,
  protocolVersion: Schema.BigInt,
  networkId: Schema.String,
  offset: Schema.optional(Schema.BigInt),
});

type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;

export const makeDefaultV1SerializationCapability = (): SerializationCapability<DustCoreWallet, null, string> => {
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: DustCoreWallet): Snapshot => ({
        publicKey: w.publicKey,
        state: w.state,
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        offset: w.progress?.appliedIndex,
      });

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (aux, serialized): Either.Either<DustCoreWallet, WalletError.WalletError> => {
      return pipe(
        serialized,
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => WalletError.WalletError.other(err)),
        Either.flatMap((snapshot: Snapshot) =>
          Either.try({
            try: () =>
              DustCoreWallet.restore(
                snapshot.state,
                snapshot.publicKey,
                [],
                {
                  appliedIndex: snapshot.offset ?? 0n,
                  highestRelevantWalletIndex: 0n,
                  highestIndex: 0n,
                  highestRelevantIndex: 0n,
                  isConnected: false,
                },
                snapshot.protocolVersion,
                snapshot.networkId,
              ),
            catch: (err) => WalletError.WalletError.other(err),
          }),
        ),
      );
    },
  };
};
