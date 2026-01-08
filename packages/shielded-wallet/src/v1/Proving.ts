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
import { HttpProverClient, WasmProverClient, ProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import { Effect, pipe } from 'effect';
import { ProvingRecipe } from './ProvingRecipe.js';
import { ProvingError, WalletError } from './WalletError.js';

export interface ProvingService<TTransaction> {
  prove(recipe: ProvingRecipe<TTransaction>): Effect.Effect<TTransaction, WalletError>;
}

export type DefaultProvingConfiguration = {
  keyMaterialProvider?: KeyMaterialProvider;
};

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<ledger.FinalizedTransaction> => {
  const clientLayer = WasmProverClient.layer({
    keyMaterialProvider: configuration.keyMaterialProvider ?? WasmProverClient.makeDefaultKeyMaterialProvider(),
  });

  return {
    prove(recipe: ProvingRecipe<ledger.FinalizedTransaction>): Effect.Effect<ledger.FinalizedTransaction, WalletError> {
      switch (recipe.type) {
        case 'BalanceTransactionToProve':
          return pipe(
            ProverClient.ProverClient,
            Effect.flatMap((client) =>
              client.proveTransaction(recipe.transactionToProve, ledger.CostModel.initialCostModel()),
            ),
            Effect.map((provenTx) => recipe.transactionToBalance.merge(provenTx.bind())),
            Effect.provide(clientLayer),
            Effect.catchAll((error) =>
              Effect.fail(
                new ProvingError({
                  message: error.message,
                  cause: error,
                }),
              ),
            ),
          );
        case 'TransactionToProve':
          return pipe(
            ProverClient.ProverClient,
            Effect.flatMap((client) =>
              client.proveTransaction(recipe.transaction, ledger.CostModel.initialCostModel()),
            ),
            Effect.map((proven) => proven.bind()),
            Effect.provide(clientLayer),
            Effect.catchAll((error) => {
              // eslint-disable-next-line no-console
              console.log(error);
              return Effect.fail(
                new ProvingError({
                  message: error.message,
                  cause: error,
                }),
              );
            }),
          );
        case 'NothingToProve':
          return Effect.succeed(recipe.transaction);
      }
    },
  };
};

export type ServerProvingConfiguration = {
  provingServerUrl: URL;
};

export const makeServerProvingService = (
  configuration: ServerProvingConfiguration,
): ProvingService<ledger.FinalizedTransaction> => {
  const clientLayer = HttpProverClient.layer({
    url: configuration.provingServerUrl,
  });

  return {
    prove(recipe: ProvingRecipe<ledger.FinalizedTransaction>): Effect.Effect<ledger.FinalizedTransaction, WalletError> {
      switch (recipe.type) {
        case 'BalanceTransactionToProve':
          return pipe(
            ProverClient.ProverClient,
            Effect.flatMap((client) =>
              client.proveTransaction(recipe.transactionToProve, ledger.CostModel.initialCostModel()),
            ),
            Effect.map((provenTx) => recipe.transactionToBalance.merge(provenTx.bind())),
            Effect.provide(clientLayer),
            Effect.catchAll((error) =>
              Effect.fail(
                new ProvingError({
                  message: error.message,
                  cause: error,
                }),
              ),
            ),
          );
        case 'TransactionToProve':
          return pipe(
            ProverClient.ProverClient,
            Effect.flatMap((client) =>
              client.proveTransaction(recipe.transaction, ledger.CostModel.initialCostModel()),
            ),
            Effect.map((proven) => proven.bind()),
            Effect.provide(clientLayer),
            Effect.catchAll((error) => {
              // eslint-disable-next-line no-console
              console.log(error);
              return Effect.fail(
                new ProvingError({
                  message: error.message,
                  cause: error,
                }),
              );
            }),
          );
        case 'NothingToProve':
          return Effect.succeed(recipe.transaction);
      }
    },
  };
};

export const makeSimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction> => {
  return {
    prove(
      recipe: ProvingRecipe<ledger.ProofErasedTransaction>,
    ): Effect.Effect<ledger.ProofErasedTransaction, WalletError> {
      switch (recipe.type) {
        case 'BalanceTransactionToProve':
          return pipe(
            Effect.succeed(recipe.transactionToProve.eraseProofs()),
            Effect.map((proven) => recipe.transactionToBalance.merge(proven)),
          );
        case 'TransactionToProve':
          return Effect.succeed(recipe.transaction.eraseProofs());
        case 'NothingToProve':
          return Effect.succeed(recipe.transaction);
      }
    },
  };
};
