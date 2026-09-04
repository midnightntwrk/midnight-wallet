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
 * Which line of the key-material bucket the bundled provider reads.
 *
 * @remarks
 *   The line is a property of the circuits the keys were generated for, not of the ledger version driving the proof, so
 *   it has to be nameable. Which line pairs with which ledger is settled empirically in
 *   `preForkWasmProver.integration.test.ts`; this file only pins down that naming a line reads that line, and that
 *   naming none reads the one both ledgers accept.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as WasmProver from '../WasmProver.js';

const S3 = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';

describe('Where the bundled prover looks for its key material', () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    requested.length = 0;
    globalThis.fetch = (input: string | URL | Request) => {
      requested.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('reads the line it is asked for', async () => {
    const provider = WasmProver.makeDefaultKeyMaterialProvider({ circuits: 8 });

    const material = await provider.lookupKey('midnight/zswap/spend');

    expect(requested).toStrictEqual([
      `${S3}/zswap/8/spend.prover`,
      `${S3}/zswap/8/spend.verifier`,
      `${S3}/zswap/8/spend.bzkir`,
    ]);
    expect(material).toStrictEqual({
      proverKey: new Uint8Array([1, 2, 3]),
      verifierKey: new Uint8Array([1, 2, 3]),
      ir: new Uint8Array([1, 2, 3]),
    });
  });

  it('reads the line both ledger versions accept when it is asked for none', async () => {
    const provider = WasmProver.makeDefaultKeyMaterialProvider();

    await provider.lookupKey('midnight/dust/spend');

    expect(requested).toStrictEqual([
      `${S3}/dust/9/spend.prover`,
      `${S3}/dust/9/spend.verifier`,
      `${S3}/dust/9/spend.bzkir`,
    ]);
  });

  it('has nothing to offer for a key location it does not know', async () => {
    const provider = WasmProver.makeDefaultKeyMaterialProvider({ circuits: 8 });

    await expect(provider.lookupKey('midnight/unheard-of')).resolves.toBeUndefined();
    expect(requested).toStrictEqual([]);
  });

  it('reads the proving parameters once, whichever line it was asked for', async () => {
    const provider = WasmProver.makeDefaultKeyMaterialProvider({ circuits: 8 });

    await provider.getParams(14);
    await provider.getParams(14);

    expect(requested).toStrictEqual([`${S3}/bls_midnight_2p14`]);
  });
});
