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
 * Proving on ledger-v9.
 *
 * @remarks
 *   The ledger-v9 twin of `v8ProvingService.ts`, built on the version-neutral contracts in `provingService.ts`: obtain a
 *   proving provider, drive the transaction's own `prove` with ledger-v9's cost model, report failures as a
 *   {@link ProvingError}.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
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
  type ProvingService,
  type ProvingServiceEffect,
  type ServerProvingConfiguration,
  type WasmProvingConfiguration,
} from './provingService.js';

/** A ledger-v9 transaction that has not been proved yet. */
export type V9UnprovenTransaction = ledger.UnprovenTransaction;

/** A ledger-v9 transaction that has been proved but not yet bound. */
export type V9UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/** A proving backend written against ledger-v9. */
export type V9ProvingServiceEffect = ProvingServiceEffect<V9UnboundTransaction, V9UnprovenTransaction>;

/** The promise-facing surface of a {@link V9ProvingServiceEffect}. */
export type V9ProvingService = ProvingService<V9UnboundTransaction, V9UnprovenTransaction>;

const wrapEffectService = <TProven, TUnproven>(
  effectService: ProvingServiceEffect<TProven, TUnproven>,
): ProvingService<TProven, TUnproven> => ({
  prove: (transaction) => Effect.runPromise(effectService.prove(transaction)),
});

/**
 * Drives a ledger-v9 transaction's proving with a low-level proving provider.
 *
 * @param provider The proving provider, or the reason one could not be built.
 * @returns A backend that proves ledger-v9 transactions.
 */
export const fromV9ProvingProviderEffect = (
  provider: Effect.Effect<
    ledger.ProvingProvider,
    InvalidProtocolSchemeError | HttpProverClient.InvalidMaxConcurrentRequestsError
  >,
): V9ProvingServiceEffect => {
  return {
    prove(transaction: V9UnprovenTransaction): Effect.Effect<V9UnboundTransaction, ProvingFailure> {
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
        Effect.catchAll((error) =>
          Effect.fail(
            new ProvingError({
              message: error.message,
              cause: error,
            }),
          ),
        ),
      );
    },
  };
};

/**
 * Drives a ledger-v9 transaction's proving with a low-level proving provider.
 *
 * @param provider The proving provider.
 * @returns A backend that proves ledger-v9 transactions.
 */
export const fromV9ProvingProvider = (provider: ledger.ProvingProvider): V9ProvingServiceEffect => {
  return fromV9ProvingProviderEffect(Effect.succeed(provider));
};

/**
 * Proves ledger-v9 transactions at a proof server.
 *
 * @example
 *   ```typescript
 *   const proving = makeV9ServerProvingServiceEffect({ provingServerUrl: new URL('http://localhost:6300') });
 *   const unbound = yield* proving.prove(unprovenTransaction);
 *   ```;
 *
 * @param configuration The proof server to send ledger-v9 proving requests to.
 * @returns A backend that proves ledger-v9 transactions over HTTP.
 */
export const makeV9ServerProvingServiceEffect = (configuration: ServerProvingConfiguration): V9ProvingServiceEffect => {
  return pipe(
    HttpProverClient.create({
      url: configuration.provingServerUrl,
      ...(configuration.maxConcurrentRequests === undefined
        ? {}
        : { maxConcurrentRequests: configuration.maxConcurrentRequests }),
    }),
    Effect.map((client) => client.asProvingProvider()),
    fromV9ProvingProviderEffect,
  );
};

/**
 * Proves ledger-v9 transactions in this process.
 *
 * @remarks
 *   The ledger-v9 twin of `makeV8WasmProvingServiceEffect`: the same bundled prover, with ledger-v9's key material —
 *   circuit generation 10 ({@link WasmProver.makeV9KeyMaterialProvider}) — unless it is given key material of its own.
 * @param configuration Optional key material override.
 * @returns A backend that proves ledger-v9 transactions in-process.
 */
export const makeV9WasmProvingServiceEffect = (configuration?: WasmProvingConfiguration): V9ProvingServiceEffect => {
  return pipe(
    WasmProver.create({
      keyMaterialProvider: configuration?.keyMaterialProvider ?? WasmProver.makeV9KeyMaterialProvider(),
    }),
    Effect.map((prover) => prover.asProvingProvider()),
    fromV9ProvingProviderEffect,
  );
};

/**
 * Erases the proofs of ledger-v9 transactions instead of proving them, for the in-memory simulator.
 *
 * @example
 *   ```typescript
 *   const proving = makeV9SimulatorProvingServiceEffect();
 *   const proofErased = yield* proving.prove(unprovenTransaction);
 *   yield* simulator.submitTransaction(proofErased);
 *   ```;
 *
 * @returns A backend that hands back each ledger-v9 transaction proof-erased, which the simulator accepts.
 */
export const makeV9SimulatorProvingServiceEffect = (): ProvingServiceEffect<
  ledger.ProofErasedTransaction,
  V9UnprovenTransaction
> => {
  return {
    prove(transaction: V9UnprovenTransaction): Effect.Effect<ledger.ProofErasedTransaction, ProvingError> {
      return Effect.succeed(transaction.eraseProofs());
    },
  };
};

/**
 * The promise-facing surface of {@link makeV9ServerProvingServiceEffect}.
 *
 * @example
 *   ```typescript
 *   const proving = makeV9ServerProvingService({ provingServerUrl: new URL('http://localhost:6300') });
 *   const unbound = await proving.prove(unprovenTransaction);
 *   ```;
 *
 * @param configuration The proof server to send ledger-v9 proving requests to.
 * @returns A backend that proves ledger-v9 transactions over HTTP.
 */
export const makeV9ServerProvingService = (configuration: ServerProvingConfiguration): V9ProvingService =>
  wrapEffectService(makeV9ServerProvingServiceEffect(configuration));

/**
 * The promise-facing surface of {@link makeV9WasmProvingServiceEffect}.
 *
 * @example
 *   ```typescript
 *   const proving = makeV9WasmProvingService();
 *   const unbound = await proving.prove(unprovenTransaction);
 *   ```;
 *
 * @param configuration Optional key material override.
 * @returns A backend that proves ledger-v9 transactions in-process.
 */
export const makeV9WasmProvingService = (configuration?: WasmProvingConfiguration): V9ProvingService =>
  wrapEffectService(makeV9WasmProvingServiceEffect(configuration));

/**
 * The promise-facing surface of {@link makeV9SimulatorProvingServiceEffect}.
 *
 * @example
 *   ```typescript
 *   const proving = makeV9SimulatorProvingService();
 *   const proofErased = await proving.prove(unprovenTransaction);
 *   ```;
 *
 * @returns A backend that hands back each ledger-v9 transaction proof-erased, which the simulator accepts.
 */
export const makeV9SimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction, V9UnprovenTransaction> =>
  wrapEffectService(makeV9SimulatorProvingServiceEffect());
