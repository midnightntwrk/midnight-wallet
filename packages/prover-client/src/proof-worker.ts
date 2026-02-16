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
import { Schema } from 'effect';
import { check, prove, type KeyMaterialProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import {
  GetParamsOperationResultSchema,
  CheckOperationSchema,
  ProveOperationSchema,
  LookupKeyOperationResultSchema,
  ResponseFromWorkerSchema,
  LookupKeyRequestSchema,
  GetParamsRequestSchema,
} from './effect/WasmProver.js';

const MAX_TIME_TO_PROCESS = 10 * 60 * 1000;

const keyMaterialProvider: KeyMaterialProvider = {
  lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined> {
    return new Promise((resolve, reject) => {
      postMessage(Schema.encodeSync(LookupKeyRequestSchema)({ op: 'lookupKey', keyLocation }));

      const subscription = ({ data }: MessageEvent<MessageData>) => {
        const decoded = Schema.decodeUnknownSync(MessageDataSchema)(data);
        if (decoded.op === 'lookupKey' && decoded.keyLocation === keyLocation) {
          removeEventListener('message', subscription);
          resolve(decoded.result);
        }
      };

      addEventListener('message', subscription);
      setTimeout(() => reject(new Error(`Promise timed out for lookupKey: ${keyLocation}`)), MAX_TIME_TO_PROCESS);
    });
  },
  getParams(k: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      postMessage(Schema.encodeSync(GetParamsRequestSchema)({ op: 'getParams', k }));

      const subscription = ({ data }: MessageEvent<MessageData>) => {
        const decoded = Schema.decodeUnknownSync(MessageDataSchema)(data);
        if (decoded.op === 'getParams' && decoded.k === k) {
          removeEventListener('message', subscription);
          resolve(decoded.result);
        }
      };

      addEventListener('message', subscription);
      setTimeout(() => reject(new Error(`Promise timed out for getParams: ${k}`)), MAX_TIME_TO_PROCESS);
    });
  },
};

const MessageDataSchema = Schema.Union(
  CheckOperationSchema,
  ProveOperationSchema,
  LookupKeyOperationResultSchema,
  GetParamsOperationResultSchema,
);

type MessageData = Schema.Schema.Type<typeof MessageDataSchema>;

addEventListener('message', ({ data }: MessageEvent<MessageData>) => {
  const decoded = Schema.decodeUnknownSync(MessageDataSchema)(data);
  const { op } = decoded;

  if (op === 'check') {
    const [a] = decoded.args;

    check(a, keyMaterialProvider)
      .then((result) => {
        postMessage(
          Schema.encodeSync(ResponseFromWorkerSchema)({
            op: 'result',
            value: result,
          }),
        );
      })
      .catch((e) => {
        throw e;
      });
  } else if (op === 'prove') {
    const [a, b] = decoded.args;

    prove(a, keyMaterialProvider, b)
      .then((result) => {
        postMessage(
          Schema.encodeSync(ResponseFromWorkerSchema)({
            op: 'result',
            value: result,
          }),
        );
      })
      .catch((e) => {
        throw e;
      });
  }
});
