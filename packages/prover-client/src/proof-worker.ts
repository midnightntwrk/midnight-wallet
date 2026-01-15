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
import { Either, Encoding, Schema } from 'effect';
import { check, prove, type KeyMaterialProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';

const MAX_TIME_TO_PROCESS = 10 * 60 * 1000;

const keyMaterialProvider: KeyMaterialProvider = {
  lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined> {
    return new Promise((resolve, reject) => {
      postMessage({ op: 'lookupKey', keyLocation });

      const subscription = (message: {
        data: { op: string; keyLocation: string; result: ProvingKeyMaterial | undefined };
      }) => {
        if (message.data.op === 'lookupKey' && message.data.keyLocation === keyLocation) {
          removeEventListener('message', subscription);
          resolve(message.data.result);
        }
      };

      addEventListener('message', subscription);
      setTimeout(() => reject(new Error(`Promise timed out for lookupKey: ${keyLocation}`)), MAX_TIME_TO_PROCESS);
    });
  },
  getParams(k: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      postMessage({ op: 'getParams', k });

      const subscription = (message: { data: { op: string; k: number; result: Uint8Array } }) => {
        if (message.data.op === 'getParams' && message.data.k === k) {
          removeEventListener('message', subscription);
          resolve(message.data.result);
        }
      };

      addEventListener('message', subscription);
      setTimeout(() => reject(new Error(`Promise timed out for getParams: ${k}`)), MAX_TIME_TO_PROCESS);
    });
  },
};

const CheckOperationSchema = Schema.Struct({
  op: Schema.Literal('check'),
  args: Schema.Tuple(Schema.Uint8ArrayFromBase64),
});

const ProveOperationSchema = Schema.Struct({
  op: Schema.Literal('prove'),
  args: Schema.Tuple(Schema.Uint8ArrayFromBase64, Schema.Union(Schema.BigIntFromSelf, Schema.Undefined)),
});

const LookupKeyOperationSchema = Schema.Struct({
  op: Schema.Literal('lookupKey'),
  keyLocation: Schema.String,
});

const GetParamsOperationSchema = Schema.Struct({
  op: Schema.Literal('getParams'),
  k: Schema.Number,
});

const MessageDataSchema = Schema.Union(
  CheckOperationSchema,
  ProveOperationSchema,
  LookupKeyOperationSchema,
  GetParamsOperationSchema,
);

type MessageData = Schema.Schema.Type<typeof MessageDataSchema>;

addEventListener('message', ({ data }: MessageEvent<MessageData>) => {
  const decoded = Schema.decodeUnknownSync(MessageDataSchema)(data);
  const { op } = decoded;

  if (op === 'check') {
    const [a] = decoded.args;

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
    const [a, b] = decoded.args;

    prove(a, keyMaterialProvider, b)
      .then((result) => {
        postMessage({
          op: 'result',
          value: Encoding.encodeBase64(result),
        });
      })
      .catch((e) => {
        throw e;
      });
  }
});
