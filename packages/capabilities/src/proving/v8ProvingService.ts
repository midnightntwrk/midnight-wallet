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
/**
 * Proving on ledger-v8.
 *
 * @remarks
 *   The ledger-v8 twin of the backends in `provingService.ts`: structurally the same three steps — obtain a proving
 *   provider, drive the transaction's own `prove` with that ledger version's cost model, report failures as a
 *   {@link ProvingError} — against a different ledger version's classes. It is the classes that make this a separate
 *   module: a ledger-v8 transaction handed ledger-v9's cost model fails at the wasm-bindgen boundary, and a
 *   proof-server request framed by ledger-v9 is not the request ledger-v8 would have sent.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HttpProverClient, WasmProver } from '@midnightntwrk/wallet-sdk-prover-client/effect';
import {
  ClientError,
  type InvalidProtocolSchemeError,
  ServerError,
} from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Effect, pipe } from 'effect';
import {
  ProvingError,
  type ProvingFailure,
  type ProvingServiceEffect,
  type ServerProvingConfiguration,
  type WasmProvingConfiguration,
} from './provingService.js';

/** A ledger-v8 transaction that has not been proved yet. */
export type V8UnprovenTransaction = ledger.UnprovenTransaction;

/** A ledger-v8 transaction that has been proved but not yet bound. */
export type V8UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/** A proving backend written against ledger-v8. */
export type V8ProvingServiceEffect = ProvingServiceEffect<V8UnboundTransaction, V8UnprovenTransaction>;

/**
 * Drives a ledger-v8 transaction's proving with a low-level proving provider.
 *
 * @param provider The proving provider, or the reason one could not be built.
 * @returns A backend that proves ledger-v8 transactions.
 */
export const fromV8ProvingProviderEffect = (
  provider: Effect.Effect<ledger.ProvingProvider, InvalidProtocolSchemeError>,
): V8ProvingServiceEffect => ({
  prove(transaction: V8UnprovenTransaction): Effect.Effect<V8UnboundTransaction, ProvingFailure> {
    return pipe(
      provider,
      Effect.flatMap((provider) =>
        Effect.tryPromise({
          try: () => transaction.prove(provider, ledger.CostModel.initialCostModel()),
          catch: (error) =>
            error instanceof ClientError || error instanceof ServerError
              ? error
              : new ClientError({ message: 'Failed to prove transaction', cause: error }),
        }),
      ),
      Effect.catchAll((error) => Effect.fail(new ProvingError({ message: error.message, cause: error }))),
    );
  },
});

/**
 * Drives a ledger-v8 transaction's proving with a low-level proving provider.
 *
 * @param provider The proving provider.
 * @returns A backend that proves ledger-v8 transactions.
 */
export const fromV8ProvingProvider = (provider: ledger.ProvingProvider): V8ProvingServiceEffect =>
  fromV8ProvingProviderEffect(Effect.succeed(provider));

/**
 * Proves ledger-v8 transactions at a proof server.
 *
 * @param configuration The proof server to send ledger-v8 proving requests to.
 * @returns A backend that proves ledger-v8 transactions over HTTP.
 */
export const makeV8ServerProvingServiceEffect = (configuration: ServerProvingConfiguration): V8ProvingServiceEffect =>
  pipe(
    HttpProverClient.create({ url: configuration.provingServerUrl }),
    Effect.map((client) => client.asV8ProvingProvider()),
    fromV8ProvingProviderEffect,
  );

/**
 * Proves ledger-v8 transactions in this process.
 *
 * @remarks
 *   The zkir runtime the bundled prover drives is shared by both ledger lines, so there is nothing version-specific about
 *   the proving loop — and the key material ledger-v8 accepts turns out to be the same line the current one uses, which
 *   is why no key-material override is applied here. See the ledger-v8 spike in `prover-client`'s
 *   `v8WasmProver.integration.test.ts` for the evidence.
 * @param configuration Optional key material override.
 * @returns A backend that proves ledger-v8 transactions in-process.
 */
export const makeV8WasmProvingServiceEffect = (configuration?: WasmProvingConfiguration): V8ProvingServiceEffect =>
  pipe(
    WasmProver.create({
      keyMaterialProvider: configuration?.keyMaterialProvider ?? WasmProver.makeDefaultKeyMaterialProvider(),
    }),
    Effect.map((prover) => prover.asProvingProvider()),
    fromV8ProvingProviderEffect,
  );
