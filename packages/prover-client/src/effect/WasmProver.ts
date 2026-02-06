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
import { Context, Effect, Encoding, Layer, Schema, pipe } from 'effect';
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

export const create = (
  config: ProverClient.WasmConfig,
): Effect.Effect<ProverClient.Service, InvalidProtocolSchemeError> => {
  return Effect.succeed(new WasmProverImpl(config.keyMaterialProvider));
};

const MAX_TIME_TO_PROCESS = 10 * 60 * 1000;

const LookupKeySchema = Schema.Struct({
  op: Schema.Literal('lookupKey'),
  keyLocation: Schema.String,
});

const GetParamsSchema = Schema.Struct({
  op: Schema.Literal('getParams'),
  k: Schema.Number,
});

const ResponseSchema = Schema.Struct({
  op: Schema.Literal('result'),
  value: Schema.Union(Schema.Uint8ArrayFromBase64, Schema.Array(Schema.Union(Schema.BigIntFromSelf, Schema.Undefined))),
});

const MessageDataSchema = Schema.Union(LookupKeySchema, GetParamsSchema, ResponseSchema);

type MessageData = Schema.Schema.Type<typeof MessageDataSchema>;

const callProverWorker = <RResponse>(
  kmProvider: KeyMaterialProvider,
  op: 'check' | 'prove',
  args: [Uint8Array, (bigint | undefined)?],
): Promise<RResponse> => {
  return new Promise((resolve, reject) => {
    const currentFile = import.meta.url;
    const worker = new Worker(new URL(`../../dist/proof-worker.js`, currentFile), { type: 'module' });

    // initialize worker
    worker.postMessage({ op, args: [Encoding.encodeBase64(args[0]), args[1]] });

    // a message from the worker
    worker.addEventListener('message', ({ data }: { data: MessageData }) => {
      const decoded = Schema.decodeUnknownSync(MessageDataSchema)(data);
      const { op } = decoded;
      if (op === 'lookupKey') {
        const { keyLocation } = decoded;
        kmProvider
          .lookupKey(keyLocation)
          .then((result) => {
            worker.postMessage({ op, keyLocation, result });
          })
          .catch((e: Error) => {
            worker.terminate();
            reject(e);
          });
      } else if (op === 'getParams') {
        const { k } = decoded;
        kmProvider
          .getParams(k)
          .then((result) => {
            worker.postMessage({ op, k, result });
          })
          .catch((e: Error) => {
            worker.terminate();
            reject(e);
          });
      } else if (op === 'result') {
        const { value } = decoded;
        worker.terminate();
        resolve(value as RResponse);
      }
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      worker.terminate();
      reject(Error(e.message));
    });
    setTimeout(() => {
      worker.terminate();
      reject(new Error(`${op} action timed out`));
    }, MAX_TIME_TO_PROCESS);
  });
};

class WasmProverImpl implements Context.Tag.Service<ProverClient> {
  constructor(keyMaterialProvider: KeyMaterialProvider) {
    this.keyMaterialProvider = keyMaterialProvider;
  }

  protected readonly keyMaterialProvider: KeyMaterialProvider;

  private wasmProverProvider = (keyMaterialProvider?: KeyMaterialProvider): ledger.ProvingProvider => ({
    check: async (serializedPreimage: Uint8Array, _keyLocation: string): Promise<(bigint | undefined)[]> =>
      callProverWorker<Array<bigint | undefined>>(keyMaterialProvider ?? this.keyMaterialProvider, 'check', [
        serializedPreimage,
      ]),
    prove: async (
      serializedPreimage: Uint8Array,
      _keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> =>
      callProverWorker<Uint8Array>(keyMaterialProvider ?? this.keyMaterialProvider, 'prove', [
        serializedPreimage,
        overwriteBindingInput,
      ]),
  });

  proveTransaction<S extends ledger.Signaturish, B extends ledger.Bindingish>(
    transaction: ledger.Transaction<S, ledger.PreProof, B>,
    costModel: ledger.CostModel,
    keyMaterialProvider?: KeyMaterialProvider,
  ): Effect.Effect<ledger.Transaction<S, ledger.Proof, B>, ClientError> {
    return pipe(
      Effect.succeed(this.wasmProverProvider(keyMaterialProvider)),
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

  asProvingProvider() {
    return this.wasmProverProvider();
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
        // eslint-disable-next-line no-console
        console.error('Failed to fetch at attempt', i + 1, url, e);
        // cooldown a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i + 1)));
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

      const data = await fetchWithRetry(`${s3}/bls_midnight_2p${k}`);
      const result = new Uint8Array(await data.arrayBuffer());
      cache.set(cacheKey, result);

      return result;
    },
  };
  return keyMaterialProvider;
};
