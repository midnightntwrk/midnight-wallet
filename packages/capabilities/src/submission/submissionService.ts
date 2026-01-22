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
import { Data, Deferred, Effect, Encoding, Exit, pipe, Scope } from 'effect';
import {
  NodeClient,
  type NodeClientError,
  PolkadotNodeClient,
  SubmissionEvent as SubmissionEventImported,
} from '@midnight-ntwrk/wallet-sdk-node-client/effect';
import { SerializedTransaction } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { type FinalizedTransaction } from '@midnight-ntwrk/ledger-v7';

export const SubmissionEvent = SubmissionEventImported;
export type SubmissionEvent = SubmissionEventImported.SubmissionEvent;
export declare namespace SubmissionEventCases {
  export type Finalized = SubmissionEventImported.Cases.Finalized;
  export type Submitted = SubmissionEventImported.Cases.Submitted;
  export type InBlock = SubmissionEventImported.Cases.InBlock;
}

export class SubmissionError extends Data.TaggedError('SubmissionError')<{
  message: string;
  cause?: unknown;
}> {}

export type SubmitTransactionMethod<TTransaction> = {
  (transaction: TTransaction, waitForStatus: 'Submitted'): Promise<SubmissionEventCases.Submitted>;
  (transaction: TTransaction, waitForStatus: 'InBlock'): Promise<SubmissionEventCases.InBlock>;
  (transaction: TTransaction, waitForStatus: 'Finalized'): Promise<SubmissionEventCases.Finalized>;
  (transaction: TTransaction): Promise<SubmissionEventCases.InBlock>;
  (transaction: TTransaction, waitForStatus?: 'Submitted' | 'InBlock' | 'Finalized'): Promise<SubmissionEvent>;
};

export type SubmitTransactionMethodEffect<TTransaction> = {
  (
    transaction: TTransaction,
    waitForStatus: 'Submitted',
  ): Effect.Effect<SubmissionEventCases.Submitted, SubmissionError>;
  (transaction: TTransaction, waitForStatus: 'InBlock'): Effect.Effect<SubmissionEventCases.InBlock, SubmissionError>;
  (
    transaction: TTransaction,
    waitForStatus: 'Finalized',
  ): Effect.Effect<SubmissionEventCases.Finalized, SubmissionError>;
  (transaction: TTransaction): Effect.Effect<SubmissionEventCases.InBlock, SubmissionError>;
  (
    transaction: TTransaction,
    waitForStatus?: 'Submitted' | 'InBlock' | 'Finalized',
  ): Effect.Effect<SubmissionEvent, SubmissionError>;
};

export interface SubmissionServiceEffect<TTransaction> {
  submitTransaction: SubmitTransactionMethodEffect<TTransaction>;
  close(): Effect.Effect<void>;
}

export interface SubmissionService<TTransaction> {
  submitTransaction: SubmitTransactionMethod<TTransaction>;
  close(): Promise<void>;
}

export type DefaultSubmissionConfiguration = {
  relayURL: URL;
};

export const makeDefaultSubmissionServiceEffect = <
  TTransaction extends { serialize: () => Uint8Array } = FinalizedTransaction,
>(
  config: DefaultSubmissionConfiguration,
): SubmissionServiceEffect<TTransaction> => {
  //Using Deferred under the hood + allowing for "close" method in the service allows to keep resource usage in check and a synchronous API
  type ScopeAndClient = { scope: Scope.CloseableScope; client: NodeClient.Service };

  const scopeAndClientDeferred = Deferred.make<ScopeAndClient, NodeClientError.NodeClientError>().pipe(Effect.runSync);

  const makeScopeAndClient: Effect.Effect<ScopeAndClient, NodeClientError.NodeClientError> = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const client = yield* PolkadotNodeClient.make({
      nodeURL: config.relayURL,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    return { scope, client };
  });

  void pipe(scopeAndClientDeferred, Deferred.complete(makeScopeAndClient), Effect.runPromise);

  const submit = (transaction: TTransaction, waitForStatus: SubmissionEvent['_tag'] = 'InBlock') => {
    return pipe(
      NodeClient.sendMidnightTransactionAndWait(SerializedTransaction.from(transaction), waitForStatus),
      Effect.provideServiceEffect(
        NodeClient.NodeClient,
        pipe(
          scopeAndClientDeferred,
          Deferred.await,
          Effect.map(({ client }) => client),
        ),
      ),
      Effect.mapError((err) => new SubmissionError({ message: 'Transaction submission error', cause: err })),
    );
  };

  return {
    submitTransaction: submit as SubmitTransactionMethodEffect<TTransaction>,
    close(): Effect.Effect<void> {
      return pipe(
        scopeAndClientDeferred,
        Deferred.await,
        Effect.flatMap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.ignoreLogged,
      );
    },
  };
};

export const makeDefaultSubmissionService = <
  TTransaction extends { serialize: () => Uint8Array } = FinalizedTransaction,
>(
  config: DefaultSubmissionConfiguration,
): SubmissionService<TTransaction> => {
  const effectService = makeDefaultSubmissionServiceEffect<TTransaction>(config);

  const submit = (transaction: TTransaction, waitForStatus: SubmissionEvent['_tag'] = 'InBlock') =>
    effectService.submitTransaction(transaction, waitForStatus).pipe(Effect.runPromise);

  return {
    submitTransaction: submit as SubmitTransactionMethod<TTransaction>,
    close: () => effectService.close().pipe(Effect.runPromise),
  };
};

export type SimulatorSubmissionConfiguration<TTransaction> = {
  simulator: {
    submitTransaction: (transaction: TTransaction) => Effect.Effect<{ blockNumber: bigint; blockHash: string }, Error>;
  };
};
export const makeSimulatorSubmissionService =
  <TTransaction extends { serialize: () => Uint8Array }>(
    waitForStatus: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
  ) =>
  (config: SimulatorSubmissionConfiguration<TTransaction>): SubmissionServiceEffect<TTransaction> => {
    const submit = (transaction: TTransaction): Effect.Effect<SubmissionEvent, SubmissionError> => {
      return config.simulator.submitTransaction(transaction).pipe(
        Effect.map((output) => {
          const serializedTransaction = SerializedTransaction.from(transaction);
          const fakeTxHash = Encoding.encodeHex(serializedTransaction).slice(0, 64);
          // Let's mimic node's client behavior here
          switch (waitForStatus) {
            case 'Submitted':
              return SubmissionEvent.Submitted({
                tx: serializedTransaction,
                txHash: fakeTxHash,
              });
            case 'InBlock':
              return SubmissionEvent.InBlock({
                tx: serializedTransaction,
                blockHash: output.blockHash,
                blockHeight: output.blockNumber,
                txHash: fakeTxHash,
              });
            case 'Finalized':
              return SubmissionEvent.Finalized({
                tx: serializedTransaction,
                blockHash: output.blockHash,
                blockHeight: output.blockNumber,
                txHash: fakeTxHash,
              });
          }
        }),
        Effect.mapError((err) => new SubmissionError({ message: 'Transaction submission error', cause: err })),
      );
    };

    return {
      submitTransaction: submit as SubmitTransactionMethodEffect<TTransaction>,
      close: (): Effect.Effect<void> => Effect.void,
    };
  };
