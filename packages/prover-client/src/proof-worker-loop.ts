// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnightntwrk/zkir-v2';
import {
  GetParamsOperationResultSchema,
  CheckOperationSchema,
  ProveOperationSchema,
  LookupKeyOperationResultSchema,
  ResponseFromWorkerSchema,
  LookupKeyRequestSchema,
  GetParamsRequestSchema,
} from './effect/WasmProver.js';

/**
 * The part of a zkir runtime a proof worker drives. Each ZKIR version has its own runtime package, and they share this
 * shape, so one worker loop serves either.
 */
export type ZkirRuntime = Readonly<{
  check: (serializedPreimage: Uint8Array, provider: KeyMaterialProvider) => Promise<(bigint | undefined)[]>;
  prove: (
    serializedPreimage: Uint8Array,
    provider: KeyMaterialProvider,
    overwriteBindingInput?: bigint,
  ) => Promise<Uint8Array>;
}>;

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

/**
 * Answers the check and prove requests sent to this worker with the given runtime, asking the main thread for key
 * material and public parameters as the runtime needs them.
 *
 * @param runtime The runtime for the ZKIR version of the circuits this worker is sent.
 */
export const serveProofs = ({ check, prove }: ZkirRuntime): void => {
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
};
