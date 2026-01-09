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
import { Effect } from 'effect';
import { ProverClient, HttpProverClient as _HttpProverClient } from './effect/index.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';

/**
 * Sends serialized unproven transactions to a Proof Server over HTTP.
 */
export class HttpProverClient {
  #innerClient: ProverClient.ProverClient.Service;

  /**
   * Initializes a new {@link HttpProverClient}.
   *
   * @param config The server configuration to use when configuring the HTTP elements of the Proof Server.
   * @throws {@link ProverClient.InvalidProtocolSchemeError}
   * The `config` is invalid for a HTTP context. E.g., expecting 'http:' or 'https:' URLs but something other
   * was provided.
   */
  constructor(config: ProverClient.ProverClient.ServerConfig) {
    this.#innerClient = Effect.gen(function* () {
      return yield* ProverClient.ProverClient;
    }).pipe(Effect.provide(_HttpProverClient.layer(config)), Effect.runSync);
  }

  /**
   * Proves an unproven transaction by submitting it over HTTP to an associated Proof Server.
   *
   * @param transaction An unproven ledger transaction.
   * @returns A `Promise` that resolves with a proven transaction or fails with a client or server side error.
   * @throws {@link ClientError}
   * There was an issue with the provided `transaction`, or a connection with the configured Proof
   * Server could not be initiated.
   * @throws {@link ServerError}
   * Unable to establish a connection with the configured Proof Server, or there was an internal error that
   * prevented the proof request from being executed.
   */
  proveTransaction<S extends ledger.Signaturish, B extends ledger.Bindingish>(
    transaction: ledger.Transaction<S, ledger.PreProof, B>,
    costModel?: ledger.CostModel,
  ): Promise<ledger.Transaction<S, ledger.Proof, B>> {
    return this.#innerClient.proveTransaction(transaction, costModel).pipe(Effect.runPromise);
  }
}
