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
import { Deferred, Effect, Encoding, Exit, pipe, Scope } from 'effect';
import {
  NodeClient,
  NodeClientError,
  PolkadotNodeClient,
  SubmissionEvent as SubmissionEventImported,
} from '@midnight-ntwrk/wallet-sdk-node-client/effect';
import { FinalizedTransaction, ProofErasedTransaction } from '@midnight-ntwrk/ledger-v6';
import { WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { Simulator } from './Simulator.js';
import { NetworkId } from './types/ledger.js';

export const SubmissionEvent = SubmissionEventImported;
export type SubmissionEvent = SubmissionEventImported.SubmissionEvent;
export declare namespace SubmissionEventCases {
  export type Finalized = SubmissionEventImported.Cases.Finalized;
  export type Submitted = SubmissionEventImported.Cases.Submitted;
  export type InBlock = SubmissionEventImported.Cases.InBlock;
}

export type SubmitTransactionMethod<TTransaction> = {
  (
    transaction: TTransaction,
    waitForStatus: 'Submitted',
  ): Effect.Effect<SubmissionEventCases.Submitted, WalletError.WalletError>;
  (
    transaction: TTransaction,
    waitForStatus: 'InBlock',
  ): Effect.Effect<SubmissionEventCases.InBlock, WalletError.WalletError>;
  (
    transaction: TTransaction,
    waitForStatus: 'Finalized',
  ): Effect.Effect<SubmissionEventCases.Finalized, WalletError.WalletError>;
  (transaction: TTransaction): Effect.Effect<SubmissionEventCases.InBlock, WalletError.WalletError>;
  (
    transaction: TTransaction,
    waitForStatus?: 'Submitted' | 'InBlock' | 'Finalized',
  ): Effect.Effect<SubmissionEvent, WalletError.WalletError>;
};

export interface SubmissionService<TTransaction> {
  submitTransaction: SubmitTransactionMethod<TTransaction>;
  close(): Effect.Effect<void>;
}

export type DefaultSubmissionConfiguration = {
  relayURL: URL;
  networkId: NetworkId;
};
export const makeDefaultSubmissionService = (
  config: DefaultSubmissionConfiguration,
): SubmissionService<FinalizedTransaction> => {
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

  const submit = (transaction: FinalizedTransaction, waitForStatus: SubmissionEvent['_tag'] = 'InBlock') => {
    return pipe(
      NodeClient.sendMidnightTransactionAndWait(transaction.serialize(), waitForStatus),
      Effect.provideServiceEffect(
        NodeClient.NodeClient,
        pipe(
          scopeAndClientDeferred,
          Deferred.await,
          Effect.map(({ client }) => client),
        ),
      ),
      Effect.mapError((err) => WalletError.WalletError.submission(err)),
    );
  };

  return {
    submitTransaction: submit as SubmitTransactionMethod<FinalizedTransaction>,
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

export type SimulatorSubmissionConfiguration = {
  simulator: Simulator;
};
export const makeSimulatorSubmissionService =
  (waitForStatus: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock') =>
  (config: SimulatorSubmissionConfiguration): SubmissionService<ProofErasedTransaction> => {
    const submit = (transaction: ProofErasedTransaction): Effect.Effect<SubmissionEvent, WalletError.WalletError> => {
      const serializedTx = transaction.serialize();
      return config.simulator.submitRegularTx(transaction).pipe(
        Effect.map((output) => {
          // Let's mimic node's client behavior here
          switch (waitForStatus) {
            case 'Submitted':
              return SubmissionEvent.Submitted({
                tx: serializedTx,
                txHash: Encoding.encodeHex(serializedTx.subarray(0, 32)),
              });
            case 'InBlock':
              return SubmissionEvent.InBlock({
                tx: serializedTx,
                blockHash: output.blockHash,
                blockHeight: output.blockNumber,
                txHash: Encoding.encodeHex(serializedTx.subarray(0, 32)),
              });
            case 'Finalized':
              return SubmissionEvent.Finalized({
                tx: serializedTx,
                blockHash: output.blockHash,
                blockHeight: output.blockNumber,
                txHash: Encoding.encodeHex(serializedTx.subarray(0, 32)),
              });
          }
        }),
      );
    };

    return {
      submitTransaction: submit as SubmitTransactionMethod<ProofErasedTransaction>,
      close: (): Effect.Effect<void> => Effect.void,
    };
  };
