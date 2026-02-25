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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import { HttpProverClient, WasmProver } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { ClientError, InvalidProtocolSchemeError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { Data, Effect, pipe } from 'effect';

export class ProvingError extends Data.TaggedError('Wallet.Proving')<{
  message: string;
  cause: Error;
}> {}

export interface ProvingServiceEffect<TTransaction> {
  prove(transaction: ledger.UnprovenTransaction): Effect.Effect<TTransaction, ProvingError>;
}

export interface ProvingService<TTransaction> {
  prove(transaction: ledger.UnprovenTransaction): Promise<TTransaction>;
}

export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

const wrapEffectService = <TTransaction>(
  effectService: ProvingServiceEffect<TTransaction>,
): ProvingService<TTransaction> => ({
  prove: (transaction) => Effect.runPromise(effectService.prove(transaction)),
});

export const fromProvingProviderEffect = (
  provider: Effect.Effect<ledger.ProvingProvider, InvalidProtocolSchemeError>,
): ProvingServiceEffect<UnboundTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<UnboundTransaction, ProvingError> {
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

export const fromProvingProvider = (provider: ledger.ProvingProvider): ProvingServiceEffect<UnboundTransaction> => {
  return fromProvingProviderEffect(Effect.succeed(provider));
};

export type ServerProvingConfiguration = {
  provingServerUrl: URL;
};

export type WasmProvingConfiguration = {
  keyMaterialProvider?: KeyMaterialProvider;
};

export type DefaultProvingConfiguration = ServerProvingConfiguration;

export const makeServerProvingServiceEffect = (
  configuration: ServerProvingConfiguration,
): ProvingServiceEffect<UnboundTransaction> => {
  return pipe(
    HttpProverClient.create({
      url: configuration.provingServerUrl,
    }),
    Effect.map((client) => client.asProvingProvider()),
    fromProvingProviderEffect,
  );
};

export const makeWasmProvingServiceEffect = (
  configuration?: WasmProvingConfiguration,
): ProvingServiceEffect<UnboundTransaction> => {
  return pipe(
    WasmProver.create({
      keyMaterialProvider: configuration?.keyMaterialProvider ?? WasmProver.makeDefaultKeyMaterialProvider(),
    }),
    Effect.map((prover) => prover.asProvingProvider()),
    fromProvingProviderEffect,
  );
};

export const makeSimulatorProvingServiceEffect = (): ProvingServiceEffect<ledger.ProofErasedTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<ledger.ProofErasedTransaction, ProvingError> {
      return Effect.succeed(transaction.eraseProofs());
    },
  };
};

export const makeDefaultProvingServiceEffect = (
  configuration: DefaultProvingConfiguration,
): ProvingServiceEffect<UnboundTransaction> => makeServerProvingServiceEffect(configuration);

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<UnboundTransaction> => wrapEffectService(makeDefaultProvingServiceEffect(configuration));

export const makeServerProvingService = (
  configuration: ServerProvingConfiguration,
): ProvingService<UnboundTransaction> => wrapEffectService(makeServerProvingServiceEffect(configuration));

export const makeWasmProvingService = (configuration?: WasmProvingConfiguration): ProvingService<UnboundTransaction> =>
  wrapEffectService(makeWasmProvingServiceEffect(configuration));

export const makeSimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction> =>
  wrapEffectService(makeSimulatorProvingServiceEffect());
