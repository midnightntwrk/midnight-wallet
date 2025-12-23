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

import { check, prove, type KeyMaterialProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import { parentPort, workerData } from 'worker_threads';

// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-assignment
const [op, args]: ['check' | 'prove', any[]] = workerData;

const keyMaterialProvider: KeyMaterialProvider = {
  lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined> {
    return new Promise((resolve, reject) => {
      console.log('worker: asking for keys: ', keyLocation);
      parentPort!.postMessage({ op: 'lookupKey', keyLocation });

      const subscription = (message: { op: string; keyLocation: string; result: ProvingKeyMaterial | undefined }) => {
        if (message.op === 'lookupKey' && message.keyLocation === keyLocation) {
          console.log('worker: received results for lookupKey: ', message.keyLocation);
          parentPort!.off('message', subscription);
          resolve(message.result);
        }
      };

      parentPort!.on('message', subscription);
    });
  },
  getParams(k: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      console.log('worker: asking for params: ', k);
      parentPort!.postMessage({ op: 'getParams', k });

      const subscription = (message: { op: string; k: number; result: Uint8Array }) => {
        if (message.op === 'getParams' && message.k === k) {
          console.log('worker: received results for getParams: ', message.k);
          parentPort!.off('message', subscription);
          resolve(message.result);
        }
      };

      parentPort!.on('message', subscription);
    });
  },
};

// we handle polymorphic data here
// @ts-nocheck
if (op === 'check') {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const [a] = args;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await check(a, keyMaterialProvider);
  parentPort!.postMessage({
    op: 'result',
    value: result,
  });
} else if (op === 'prove') {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const [a, b] = args;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await prove(a, keyMaterialProvider, b);
  parentPort!.postMessage({
    op: 'result',
    value: result,
  });
}
