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

import { provingProvider, type KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import { parentPort, workerData } from 'worker_threads';

// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-assignment
const [keyMaterialProvider, op, args]: [KeyMaterialProvider, 'check' | 'prove', any[]] = workerData;

const wasmProver = provingProvider(keyMaterialProvider);

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
