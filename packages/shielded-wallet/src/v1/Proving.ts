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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import { HttpProverClient, WasmProver } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { ClientError, InvalidProtocolSchemeError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { Effect, pipe } from 'effect';
import { ProvingError, WalletError } from './WalletError.js';

export interface ProvingService<TTransaction> {
  prove(transaction: ledger.UnprovenTransaction): Effect.Effect<TTransaction, WalletError>;
}

export const fromProvingProviderEffect = (
  provider: Effect.Effect<ledger.ProvingProvider, InvalidProtocolSchemeError>,
): ProvingService<ledger.FinalizedTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<ledger.FinalizedTransaction, WalletError> {
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
        Effect.map((transaction) => transaction.bind()),
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

export const fromProvingProvider = (provider: ledger.ProvingProvider): ProvingService<ledger.FinalizedTransaction> => {
  return fromProvingProviderEffect(Effect.succeed(provider));
};

export type WasmProvingConfiguration = {
  keyMaterialProvider?: KeyMaterialProvider;
};

export type ProvingServerConfiguration = {
  provingServerUrl: URL;
};

export type DefaultProvingConfiguration = ProvingServerConfiguration;

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<ledger.FinalizedTransaction> => makeServerProvingService(configuration);

export const makeServerProvingService = (
  configuration: ProvingServerConfiguration,
): ProvingService<ledger.FinalizedTransaction> => {
  return pipe(
    HttpProverClient.create({
      url: configuration.provingServerUrl,
    }),
    Effect.map((client) => client.asProvingProvider()),
    fromProvingProviderEffect,
  );
};

export const makeWasmProvingService = (
  configuration: WasmProvingConfiguration,
): ProvingService<ledger.FinalizedTransaction> => {
  return pipe(
    WasmProver.create({
      keyMaterialProvider: configuration.keyMaterialProvider ?? WasmProver.makeDefaultKeyMaterialProvider(),
    }),
    Effect.map((prover) => prover.asProvingProvider()),
    fromProvingProviderEffect,
  );
};

export const makeSimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<ledger.ProofErasedTransaction, WalletError> {
      return Effect.succeed(transaction.eraseProofs());
    },
  };
};
