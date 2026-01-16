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
import { HttpProverClient, WasmProver, ProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { InvalidProtocolSchemeError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { Effect, Layer, pipe } from 'effect';
import { ProvingError, WalletError } from './WalletError.js';

export interface ProvingService<TTransaction> {
  prove(transaction: ledger.UnprovenTransaction): Effect.Effect<TTransaction, WalletError>;
}

export const makeProvingService = (
  clientLayer: Layer.Layer<ProverClient.ProverClient, InvalidProtocolSchemeError>,
): ProvingService<ledger.FinalizedTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<ledger.FinalizedTransaction, WalletError> {
      return pipe(
        ProverClient.ProverClient,
        Effect.flatMap((client) => client.proveTransaction(transaction, ledger.CostModel.initialCostModel())),
        Effect.map((transaction) => transaction.bind()),
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
    },
  };
};

export type DefaultProvingConfiguration = {
  keyMaterialProvider?: KeyMaterialProvider;
};

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<ledger.FinalizedTransaction> => {
  const proverLayer = WasmProver.layer({
    keyMaterialProvider: configuration.keyMaterialProvider ?? WasmProver.makeDefaultKeyMaterialProvider(),
  });
  return makeProvingService(proverLayer);
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
  return makeProvingService(clientLayer);
};

export const makeSimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<ledger.ProofErasedTransaction, WalletError> {
      return Effect.succeed(transaction.eraseProofs());
    },
  };
};
