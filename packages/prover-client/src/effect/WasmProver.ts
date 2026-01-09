/* eslint-disable no-console */
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
import Worker from 'web-worker';
import { Context, Effect, Layer, pipe } from 'effect';
import { InvalidProtocolSchemeError, ClientError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { KeyMaterialProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import { ProverClient } from './ProverClient.js';

/**
 * Creates a layer for a {@link ProverClient} that sends requests to a Wasm Prover.
 *
 * @param config The Key Material Provider to use when configuring the prover's elements of the layer.
 * @returns A `Layer` for {@link ProverClient} that sends requests to a configured Wasm Prover.
 */
export const layer: (config: ProverClient.WasmConfig) => Layer.Layer<ProverClient, InvalidProtocolSchemeError> = (
  config,
) => Layer.effect(ProverClient, Effect.succeed(new WasmProverImpl(config.keyMaterialProvider)));

type WorkerMessage<RResponse> =
  | {
      op: 'lookupKey';
      keyLocation: string;
    }
  | {
      op: 'getParams';
      k: number;
    }
  | {
      op: 'result';
      value: RResponse;
    };

const callProverWorker = <RResponse>(
  kmProvider: KeyMaterialProvider,
  op: 'check' | 'prove',
  args: [Uint8Array, (bigint | undefined)?],
): Promise<RResponse> => {
  return new Promise((resolve, reject) => {
    const currentFile = import.meta.url;
    console.log('initializing worker');
    const worker = new Worker(new URL(`../../dist/proof-worker.js`, currentFile), { type: 'module' });
    console.log('posting initial message:', op);
    worker.postMessage({ op, args });
    console.log('initial message posted');

    worker.addEventListener('message', ({ data }: { data: WorkerMessage<RResponse> }) => {
      console.log('main thread: message received -> ', data.op);
      if (data.op === 'lookupKey') {
        console.log('main thread: received an ask for lookupKey ', data.keyLocation);
        kmProvider
          .lookupKey(data.keyLocation)
          .then((result) => {
            console.log('main thread:', data.keyLocation, 'keys fetched, sending results to worker');
            worker.postMessage({ op: 'lookupKey', keyLocation: data.keyLocation, result });
          })
          .catch(reject);
      } else if (data.op === 'getParams') {
        console.log('main thread: received an ask for getParams:', data.k);
        kmProvider
          .getParams(data.k)
          .then((result) => {
            console.log('main thread:', data.k, 'params fetched, posting results');
            worker.postMessage({ op: 'getParams', k: data.k, result });
          })
          .catch(reject);
      } else if (data.op === 'result') {
        console.log('main thread: received result');
        resolve(data.value);
      }
    });
    worker.addEventListener('error', reject);
  });
};

class WasmProverImpl implements Context.Tag.Service<ProverClient> {
  constructor(keyMaterialProvider: KeyMaterialProvider) {
    this.keyMaterialProvider = keyMaterialProvider;
  }

  protected readonly keyMaterialProvider: KeyMaterialProvider;

  private wasmProverProvider = (): ledger.ProvingProvider => ({
    check: async (serializedPreimage: Uint8Array, _keyLocation: string): Promise<(bigint | undefined)[]> =>
      pipe(
        Effect.succeed(
          callProverWorker<(bigint | undefined)[]>(this.keyMaterialProvider, 'check', [serializedPreimage]),
        ),
        Effect.runPromise,
      ),
    prove: async (
      serializedPreimage: Uint8Array,
      _keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> =>
      pipe(
        Effect.succeed(
          callProverWorker<Uint8Array>(this.keyMaterialProvider, 'prove', [serializedPreimage, overwriteBindingInput]),
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

export const makeDefaultKeyMaterialProvider = (): KeyMaterialProvider => {
  const cache = new Map<string, ProvingKeyMaterial | Uint8Array>();
  const s3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';
  const ver = 9;

  const fetchWithRetry = async (url: string, retries = 3): Promise<Response> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetch(url);
      } catch (e) {
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
        console.log('-> Using cached keys for', pth);
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
        console.log('-> Using cached params for', k);
        return cache.get(cacheKey) as Uint8Array;
      }

      const data = await fetchWithRetry(`${s3}/bls_midnight_2p${k}`);
      const result = new Uint8Array(await data.arrayBuffer());
      cache.set(cacheKey, result);

      return result;
    },
  };
  return keyMaterialProvider;
};
