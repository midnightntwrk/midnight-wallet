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
 * Which key material the bundled providers read for each ledger version, and from where.
 *
 * @remarks
 *   A node verifies a proof against the verifier keys of the circuit generation its ledger version was built with, so a
 *   proof has to be made with that generation's key material, byte for byte: ledger-v9's Dust spend circuit is not
 *   ledger-v8's. Each provider therefore reads its ledger version's generation from the host the ledger itself reads,
 *   and refuses any file that does not hash to what the ledger release declares.
 *
 *   The declared hashes cannot be met by stand-in bytes, so these tests read where a file was fetched from, and what it
 *   had to hash to, off the refusal. That the live host serves bytes matching the declared hashes is settled in
 *   `keyMaterial.integration.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as WasmProver from '../WasmProver.js';

const SRS = 'https://srs.midnight.network';

/** What each ledger release declares its key material hashes to, per circuit. */
const declared = {
  v9: {
    'dust/spend': '3dff9f54add761350ad02621a425d67fe3d656c8145fef8ef147870489ffdc81',
    'zswap/spend': '19d234b5c68b7212ad6b0ec9334a95594748154128f3704eb576bcc843cc5c45',
    'zswap/output': 'd992b04f13c3fd432f55fb8bfe6466d87bc181f1a2acf233ec228030bbdd4ed8',
    'zswap/sign': 'fe7268dd2bdd107f862f881ac3c5bc71a6df77ce80bfed51cf71514648e660e0',
  },
  v8: {
    'dust/spend': '996602da7ca386284e656c78ea03e55bffdba29475e6a67965c50de05e13efc2',
    'zswap/spend': '19d234b5c68b7212ad6b0ec9334a95594748154128f3704eb576bcc843cc5c45',
    'zswap/output': 'd992b04f13c3fd432f55fb8bfe6466d87bc181f1a2acf233ec228030bbdd4ed8',
    'zswap/sign': 'fe7268dd2bdd107f862f881ac3c5bc71a6df77ce80bfed51cf71514648e660e0',
  },
} as const;

const zswapCircuits = ['spend', 'output', 'sign'] as const;

describe('Where the bundled providers read their key material', () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  const respondWith = (response: () => Response) => {
    globalThis.fetch = (input: string | URL | Request) => {
      requested.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(response());
    };
  };

  beforeEach(() => {
    requested.length = 0;
    respondWith(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Settles a lookup to whatever it rejected with, or to what it resolved to if it did not. */
  const settled = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      (value) => value,
      (error: unknown) => error,
    );

  describe("ledger-v9's", () => {
    it('reads the Dust spend circuit at generation 10, from the host the ledger reads', async () => {
      const refusal = await settled(WasmProver.makeV9KeyMaterialProvider().lookupKey('midnight/dust/spend'));

      expect(requested[0]).toBe(`${SRS}/dust/10/spend.prover`);
      expect(refusal).toBeInstanceOf(WasmProver.KeyMaterialIntegrityError);
      expect(refusal).toMatchObject({ url: `${SRS}/dust/10/spend.prover`, expected: declared.v9['dust/spend'] });
    });

    it.each(zswapCircuits)('reads the zswap %s circuit at generation 10', async (circuit) => {
      const refusal = await settled(WasmProver.makeV9KeyMaterialProvider().lookupKey(`midnight/zswap/${circuit}`));

      expect(requested[0]).toBe(`${SRS}/zswap/10/${circuit}.prover`);
      expect(refusal).toMatchObject({
        url: `${SRS}/zswap/10/${circuit}.prover`,
        expected: declared.v9[`zswap/${circuit}`],
      });
    });

    it('is what the default provider reads', async () => {
      const refusal = await settled(WasmProver.makeDefaultKeyMaterialProvider().lookupKey('midnight/dust/spend'));

      expect(requested[0]).toBe(`${SRS}/dust/10/spend.prover`);
      expect(refusal).toBeInstanceOf(WasmProver.KeyMaterialIntegrityError);
      expect(refusal).toMatchObject({ url: `${SRS}/dust/10/spend.prover`, expected: declared.v9['dust/spend'] });
    });
  });

  describe("ledger-v8's", () => {
    it('reads the Dust spend circuit at generation 9, from the host the ledger reads', async () => {
      const refusal = await settled(WasmProver.makeV8KeyMaterialProvider().lookupKey('midnight/dust/spend'));

      expect(requested[0]).toBe(`${SRS}/dust/9/spend.prover`);
      expect(refusal).toBeInstanceOf(WasmProver.KeyMaterialIntegrityError);
      expect(refusal).toMatchObject({ url: `${SRS}/dust/9/spend.prover`, expected: declared.v8['dust/spend'] });
    });

    it.each(zswapCircuits)('reads the zswap %s circuit at generation 9', async (circuit) => {
      const refusal = await settled(WasmProver.makeV8KeyMaterialProvider().lookupKey(`midnight/zswap/${circuit}`));

      expect(requested[0]).toBe(`${SRS}/zswap/9/${circuit}.prover`);
      expect(refusal).toMatchObject({
        url: `${SRS}/zswap/9/${circuit}.prover`,
        expected: declared.v8[`zswap/${circuit}`],
      });
    });
  });

  it('reads the public parameters from the host the ledger reads, checked against what the ledger declares', async () => {
    const refusal = await settled(WasmProver.makeDefaultKeyMaterialProvider().getParams(14));

    expect(requested[0]).toBe(`${SRS}/bls_midnight_2p14`);
    expect(refusal).toBeInstanceOf(WasmProver.KeyMaterialIntegrityError);
    expect(refusal).toMatchObject({
      url: `${SRS}/bls_midnight_2p14`,
      expected: 'fc253016885ec830e97808c9ec920bb5cab5c21af590380a6cb5eb0538e2b244',
    });
  });

  it('refuses public parameters the ledger does not publish, without asking for them', async () => {
    const refusal = await settled(WasmProver.makeDefaultKeyMaterialProvider().getParams(26));

    expect(refusal).toBeInstanceOf(WasmProver.UnknownPublicParametersError);
    expect(refusal).toMatchObject({ k: 26 });
    expect(requested).toStrictEqual([]);
  });

  it('does not take a response that is not a success for key material, nor ask again for a missing file', async () => {
    respondWith(() => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }));

    const refusal = await settled(WasmProver.makeDefaultKeyMaterialProvider().lookupKey('midnight/dust/spend'));

    expect(refusal).toBeInstanceOf(WasmProver.KeyMaterialFetchError);
    expect(refusal).toMatchObject({ url: `${SRS}/dust/10/spend.prover`, status: 404 });
    expect(requested).toStrictEqual([`${SRS}/dust/10/spend.prover`]);
  });

  it('reads from the source it is given, and checks what it reads there all the same', async () => {
    const provider = WasmProver.makeV9KeyMaterialProvider({ source: 'https://keys.example.com/midnight' });

    const refusal = await settled(provider.lookupKey('midnight/dust/spend'));

    expect(requested[0]).toBe('https://keys.example.com/midnight/dust/10/spend.prover');
    expect(refusal).toBeInstanceOf(WasmProver.KeyMaterialIntegrityError);
    expect(refusal).toMatchObject({ expected: declared.v9['dust/spend'] });
  });

  it('has nothing to offer for a key location it does not know', async () => {
    await expect(WasmProver.makeV9KeyMaterialProvider().lookupKey('midnight/unheard-of')).resolves.toBeUndefined();
    await expect(WasmProver.makeV8KeyMaterialProvider().lookupKey('midnight/unheard-of')).resolves.toBeUndefined();
    expect(requested).toStrictEqual([]);
  });
});
