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
/**
 * Whether the host the bundled providers read serves each ledger version's key material as that ledger release declares
 * it.
 *
 * @remarks
 *   A provider hands key material back only after every file matched its pinned hash, so resolving is the whole
 *   assertion: for each ledger version, every circuit its transactions are proved with, and the public parameters that
 *   circuit's IR asks for. A failure here means the host, or the pins, no longer agree with the ledger release.
 *
 *   Network is needed; Docker is not.
 */
import { Zkir } from '@midnight-ntwrk/zkir-v2';
import { describe, expect, it } from 'vitest';
import * as WasmProver from '../WasmProver.js';

const timeoutMinutes = (mins: number) => 1_000 * 60 * mins;

const keyLocations = ['midnight/zswap/spend', 'midnight/zswap/output', 'midnight/zswap/sign', 'midnight/dust/spend'];

describe.each([
  ['ledger-v9', WasmProver.makeV9KeyMaterialProvider],
  ['ledger-v8', WasmProver.makeV8KeyMaterialProvider],
] as const)("%s's key material, as the host serves it", (_, makeProvider) => {
  const provider = makeProvider();

  it.each(keyLocations)(
    'serves %s, and the public parameters its circuit needs, as the ledger release declares them',
    async (keyLocation) => {
      const material = await provider.lookupKey(keyLocation);

      expect(material).toBeDefined();
      const k = Zkir.deserialize(material?.ir ?? new Uint8Array()).getK();
      await expect(provider.getParams(k)).resolves.toBeInstanceOf(Uint8Array);
    },
    timeoutMinutes(5),
  );
});
