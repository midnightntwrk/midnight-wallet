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
import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import { Effect, pipe } from 'effect';
import { ProvingRecipe } from './ProvingRecipe.js';
import { ProvingError, WalletError } from './WalletError.js';

export interface ProvingService<TTransaction> {
  prove(recipe: ProvingRecipe<TTransaction>): Effect.Effect<TTransaction, WalletError>;
}

export type DefaultProvingConfiguration = {
  keyMaterialProvider?: KeyMaterialProvider;
};

export const makeDefaultKeyMaterialProvider = (): KeyMaterialProvider => {
  const cache = new Map<string, ProvingKeyMaterial | Uint8Array>();
  const s3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';
  const ver = 6;

  const fetchWithRetry = async (url: string, retries = 3): Promise<Response> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetch(url);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log('Failed to fetch at attempt', i + 1, url, e);
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
  };

  const keyMaterialProvider = {
    lookupKey: async (keyLocation: string): Promise<ProvingKeyMaterial | undefined> => {
      const pth = {
        'midnight/zswap/spend': `zswap/${ver}/spend`,
        'midnight/zswap/output': `zswap/${ver}/output`,
        'midnight/zswap/sign': `zswap/${ver}/sign`,
        'midnight/dust/spend': `dust/${ver}/spend`,
      }[keyLocation];
      if (pth === undefined) {
        return undefined;
      }

      if (cache.has(pth)) {
        return cache.get(pth) as ProvingKeyMaterial;
      }

      const pk = await fetchWithRetry(`${s3}/${pth}.prover`);
      const vk = await fetchWithRetry(`${s3}/${pth}.verifier`);
      const ir = await fetchWithRetry(`${s3}/${pth}.bzkir`);

      const result = {
        proverKey: new Uint8Array(await pk.arrayBuffer()),
        verifierKey: new Uint8Array(await vk.arrayBuffer()),
        ir: new Uint8Array(await ir.arrayBuffer()),
      };
      cache.set(pth, result);

      return result;
    },
    getParams: async (k: number): Promise<Uint8Array> => {
      const cacheKey = `params-${k}`;
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey) as Uint8Array;
      }

      const data = await fetchWithRetry(`${s3}/bls_filecoin_2p${k}`);
      const result = new Uint8Array(await data.arrayBuffer());
      cache.set(cacheKey, result);

      return result;
    },
  };
  return keyMaterialProvider;
};

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<ledger.FinalizedTransaction> => {
  const clientLayer = WasmProverClient.layer({
    keyMaterialProvider: configuration.keyMaterialProvider ?? makeDefaultKeyMaterialProvider(),
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
