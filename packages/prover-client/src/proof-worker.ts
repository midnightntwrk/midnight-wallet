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

import { check, prove, type KeyMaterialProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';

const keyMaterialProvider: KeyMaterialProvider = {
  lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined> {
    return new Promise((resolve) => {
      postMessage({ op: 'lookupKey', keyLocation });

      const subscription = (message: {
        data: { op: string; keyLocation: string; result: ProvingKeyMaterial | undefined };
      }) => {
        if (message.data.op === 'lookupKey' && message.data.keyLocation === keyLocation) {
          console.log('worker: received results for lookupKey: ', message.data.keyLocation);
          removeEventListener('message', subscription);
          resolve(message.data.result);
        }
      };

      addEventListener('message', subscription);
    });
  },
  getParams(k: number): Promise<Uint8Array> {
    return new Promise((resolve) => {
      postMessage({ op: 'getParams', k });

      const subscription = (message: { data: { op: string; k: number; result: Uint8Array } }) => {
        if (message.data.op === 'getParams' && message.data.k === k) {
          console.log('worker: received results for getParams: ', message.data.k);
          removeEventListener('message', subscription);
          resolve(message.data.result);
        }
      };

      addEventListener('message', subscription);
    });
  },
};

// we handle polymorphic data here
addEventListener(
  'message',
  ({ data }: MessageEvent<{ op: 'check' | 'prove' | undefined; args: [Uint8Array, (bigint | undefined)?] }>) => {
    const { op, args } = data;
    if (op === 'check') {
      const [a] = args;

      check(a, keyMaterialProvider)
        .then((result) => {
          postMessage({
            op: 'result',
            value: result,
          });
        })
        .catch((e) => {
          throw e;
        });
    } else if (op === 'prove') {
      const [a, b] = args;

      prove(a, keyMaterialProvider, b)
        .then((result) => {
          postMessage({
            op: 'result',
            value: result,
          });
        })
        .catch((e) => {
          throw e;
        });
    }
  },
);
