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
import { Context, Effect, Layer, pipe } from 'effect';
import { ProverClient } from './ProverClient.js';
import { InvalidProtocolSchemeError, ClientError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import { Worker } from 'worker_threads';

/**
 * Creates a layer for a {@link ProverClient} that sends requests to a Wasm Prover.
 *
 * @param config The Key Material Provider to use when configuring the prover's elements of the layer.
 * @returns A `Layer` for {@link ProverClient} that sends requests to a configured Wasm Prover.
 */
export const layer: (config: ProverClient.WasmConfig) => Layer.Layer<ProverClient, InvalidProtocolSchemeError> = (
  config,
) => Layer.effect(ProverClient, Effect.succeed(new WasmProverClientImpl(config.keyMaterialProvider)));

const callProverWorker = <RResponse>(
  kmProvider: KeyMaterialProvider,
  op: 'check' | 'prove',
  args: any[],
): Promise<RResponse> => {
  return new Promise((resolve, reject) => {
    const currentFile = import.meta.url;
    const worker = new Worker(new URL(`../../dist/proof-worker.js`, currentFile), {
      workerData: [kmProvider, op, args],
    });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code: number) => {
      if (code !== 0) {
        reject(new Error(`Prover worker stopped with exit code ${code}`));
      }
    });
  });
};

class WasmProverClientImpl implements Context.Tag.Service<ProverClient> {
  constructor(keyMaterialProvider: KeyMaterialProvider) {
    this.keyMaterialProvider = keyMaterialProvider;
  }

  protected readonly keyMaterialProvider: KeyMaterialProvider;

  private wasmProverProvider = (): ledger.ProvingProvider => ({
    check: async (serializedPreimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]> =>
      pipe(
        Effect.succeed(
          callProverWorker<(bigint | undefined)[]>(this.keyMaterialProvider, 'check', [
            serializedPreimage,
            keyLocation,
          ]),
        ),
        Effect.runPromise,
      ),
    prove: async (
      serializedPreimage: Uint8Array,
      keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> =>
      pipe(
        Effect.succeed(
          callProverWorker<Uint8Array>(this.keyMaterialProvider, 'prove', [
            serializedPreimage,
            keyLocation,
            overwriteBindingInput,
          ]),
        ),
        Effect.runPromise,
      ),
  });

  proveTransaction<S extends ledger.Signaturish, B extends ledger.Bindingish>(
    transaction: ledger.Transaction<S, ledger.PreProof, B>,
    costModel: ledger.CostModel,
  ): Effect.Effect<ledger.Transaction<S, ledger.Proof, B>, ClientError> {
    return pipe(
      Effect.succeed(this.wasmProverProvider()),
      Effect.flatMap((provider) =>
        Effect.tryPromise({
          try: () => transaction.prove(provider, costModel),
          catch: (error) =>
            error instanceof ClientError
              ? error
              : new ClientError({ message: 'Failed to prove transaction', cause: error }),
        }),
      ),
    );
  }
}
