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
import { Context, Effect, Option, Stream } from 'effect';
import * as SubmissionEvent from './SubmissionEvent.js';
import * as NodeClientError from './NodeClientError.js';

export type SerializedMnTransaction = Uint8Array;

export type Genesis = { readonly transactions: readonly SerializedMnTransaction[] };

export interface Service {
  sendMidnightTransaction(
    serializedTransaction: SerializedMnTransaction,
  ): Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError>;
  getGenesis(): Effect.Effect<Genesis, NodeClientError.NodeClientError>;
}

export class NodeClient extends Context.Tag('@midnight-ntwrk/wallet-node-client#NodeClient')<NodeClient, Service>() {}

export const getGenesisTransactions = (): Effect.Effect<Genesis, NodeClientError.NodeClientError, NodeClient> =>
  NodeClient.pipe(Effect.flatMap((client) => client.getGenesis()));

export const sendMidnightTransaction = (
  serializedTransaction: SerializedMnTransaction,
): Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError, NodeClient> =>
  NodeClient.pipe(
    Stream.fromEffect,
    Stream.flatMap((client) => client.sendMidnightTransaction(serializedTransaction)),
  );

export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedMnTransaction,
  waitFor: SubmissionEvent.Cases.Submitted['_tag'],
): Effect.Effect<SubmissionEvent.Cases.Submitted, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedMnTransaction,
  waitFor: SubmissionEvent.Cases.InBlock['_tag'],
): Effect.Effect<SubmissionEvent.Cases.InBlock, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedMnTransaction,
  waitFor: SubmissionEvent.Cases.Finalized['_tag'],
): Effect.Effect<SubmissionEvent.Cases.Finalized, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedMnTransaction,
  waitFor: SubmissionEvent.SubmissionEvent['_tag'],
): Effect.Effect<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedMnTransaction,
  waitFor: SubmissionEvent.SubmissionEvent['_tag'],
): Effect.Effect<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError, NodeClient> {
  return sendMidnightTransaction(serializedTransaction).pipe(
    Stream.find(SubmissionEvent.is(waitFor)),
    Stream.runHead,
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new NodeClientError.TransactionProgressError({
              message: 'Transaction did not reach desired stage and no other error was reported',
              txData: serializedTransaction,
              desiredStage: waitFor,
            }),
          ),
        onSome: (event) => Effect.succeed(event),
      }),
    ),
  );
}
