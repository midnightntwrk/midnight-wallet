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
import {
  NodeClient,
  PolkadotNodeClient as EffectNodeClient,
  SubmissionEvent,
  NodeClientError,
  Config,
} from './effect/index.js';
import { Effect, Exit, pipe, Scope } from 'effect';
import { Observable } from '@polkadot/types/types';
import { ObservableOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export { Config, makeConfig, DEFAULT_CONFIG } from './effect/PolkadotNodeClient.js';

export class PolkadotNodeClient {
  static init(config: Config): Promise<PolkadotNodeClient> {
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const client = yield* NodeClient.NodeClient.pipe(
        Effect.provide(EffectNodeClient.layer(config)),
        Effect.provideService(Scope.Scope, scope),
      );

      return new PolkadotNodeClient(client, scope);
    }).pipe(Effect.runPromise);
  }

  readonly #effectClient: NodeClient.Service;
  readonly #scope: Scope.CloseableScope;
  private constructor(effectClient: NodeClient.Service, scope: Scope.CloseableScope) {
    this.#effectClient = effectClient;
    this.#scope = scope;
  }

  sendMidnightTransaction(
    serializedTransaction: NodeClient.SerializedMnTransaction,
  ): Observable<SubmissionEvent.SubmissionEvent> {
    return ObservableOps.fromStream(this.#effectClient.sendMidnightTransaction(serializedTransaction));
  }

  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.Cases.Submitted['_tag'],
  ): Promise<SubmissionEvent.Cases.Submitted>;
  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.Cases.InBlock['_tag'],
  ): Promise<SubmissionEvent.Cases.InBlock>;
  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.Cases.Finalized['_tag'],
  ): Promise<SubmissionEvent.Cases.Finalized>;
  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.SubmissionEvent['_tag'],
  ): Promise<SubmissionEvent.SubmissionEvent> {
    const runRequest = <A>(
      request: Effect.Effect<A, NodeClientError.NodeClientError, NodeClient.NodeClient>,
    ): Promise<A> => pipe(request, Effect.provideService(NodeClient.NodeClient, this.#effectClient), Effect.runPromise);

    return NodeClient.sendMidnightTransactionAndWait(serializedTransaction, waitFor).pipe(runRequest);
  }

  close(): Promise<void> {
    return Scope.close(this.#scope, Exit.void).pipe(Effect.runPromise);
  }
}
