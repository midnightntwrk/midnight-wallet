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
import { ProverClient, HttpProverClient, WasmProver } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { Effect, pipe } from 'effect';

export const makeServerProvingService = (
  provingServerUrl: URL,
): {
  proveTransaction: (
    transaction: ledger.UnprovenTransaction,
  ) => Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>>;
} => {
  const clientLayer = HttpProverClient.layer({
    url: provingServerUrl,
  });

  return {
    proveTransaction(
      transaction: ledger.UnprovenTransaction,
    ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>> {
      return pipe(
        ProverClient.ProverClient,
        Effect.flatMap((client) => client.proveTransaction(transaction, ledger.CostModel.initialCostModel())),
        Effect.provide(clientLayer),
        Effect.runPromise,
      );
    },
  };
};

export const makeWasmProvingService = (
  keyMaterialProvider?: KeyMaterialProvider,
): {
  proveTransaction: (
    transaction: ledger.UnprovenTransaction,
  ) => Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>>;
} => {
  const clientLayer = WasmProver.layer({
    keyMaterialProvider: keyMaterialProvider ?? WasmProver.makeDefaultKeyMaterialProvider(),
  });

  return {
    proveTransaction(
      transaction: ledger.UnprovenTransaction,
    ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>> {
      return pipe(
        ProverClient.ProverClient,
        Effect.flatMap((client) => client.proveTransaction(transaction, ledger.CostModel.initialCostModel())),
        Effect.provide(clientLayer),
        Effect.runPromise,
      );
    },
  };
};
