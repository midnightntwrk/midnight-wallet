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
import { Effect, Context } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { ClientError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';

/**
 * A client that provides proof services for unproven transactions.
 */
export class ProverClient extends Context.Tag('@midnight-ntwrk/prover-client#ProverClient')<
  ProverClient,
  ProverClient.Service
>() {}

export declare namespace ProverClient {
  /**
   * Provides server-related configuration for {@link ProverClient} implementations.
   */
  interface ServerConfig {
    /** The base URL to the Proof Server. */
    readonly url: URL | string;
  }

  /**
   * Provides wasm-related configuration for {@link KeyMaterialProvider} implementations.
   */
  interface WasmConfig {
    /** The Key Material Provider. */
    readonly keyMaterialProvider: KeyMaterialProvider;
  }

  interface Service {
    /**
     * Proves an unproven transaction by submitting it to an associated Proof Server.
     *
     * @param transaction A serialized unproven transaction.
     * @returns An `Effect` that yields with a serialized transaction representing the proven version of `transaction`;
     * or fails with a client or server side error.
     */
    proveTransaction<S extends ledger.Signaturish, B extends ledger.Bindingish>(
      tx: ledger.Transaction<S, ledger.PreProof, B>,
      costModel?: ledger.CostModel,
    ): Effect.Effect<ledger.Transaction<S, ledger.Proof, B>, ClientError | ServerError>;
  }
}
