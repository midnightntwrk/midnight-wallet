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

import { provingProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import { parentPort, workerData } from 'worker_threads';

const s3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';
const ver = 6;

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

const cache = new Map<string, ProvingKeyMaterial | Uint8Array>();

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
const wasmProver = provingProvider(keyMaterialProvider);

// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-assignment
const [op, args]: ['check' | 'prove', any[]] = workerData;
// we handle polymorphic data here
// @ts-nocheck
if (op === 'check') {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const [a, b] = args;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await wasmProver.check(a, b);
  parentPort!.postMessage(result);
} else if (op === 'prove') {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const [a, b, c] = args;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await wasmProver.prove(a, b, c);
  parentPort!.postMessage(result);
}
