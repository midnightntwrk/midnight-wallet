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
 * How a hash-checked key material provider reads, keeps and retries what it fetches, and where its pins come from.
 *
 * @remarks
 *   The real pins can only be met by the real files, so the mechanics are exercised with a descriptor of this file's own,
 *   whose pins are the hashes of stand-in bytes. The real descriptors are checked here only for what can be checked
 *   without the network: that they were copied from the ledger releases actually installed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Schedule } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type KeyMaterialDescriptor,
  KeyMaterialFetchError,
  KeyMaterialIntegrityError,
  makeKeyMaterialProvider,
  V8KeyMaterial,
  V9KeyMaterial,
} from '../KeyMaterial.js';

const SOURCE = 'https://keys.test';

/** The stand-in bytes the fake host serves at a path. */
const contentOf = (path: string): Uint8Array => new TextEncoder().encode(`content of ${path}`);

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A descriptor for generation 7 of made-up circuits, pinned to what the fake host serves. */
const testDescriptor: KeyMaterialDescriptor = {
  ledgerRelease: { packageName: '@midnightntwrk/ledger-v9', version: '0.0.0-test', tag: 'ledger-test' },
  generation: 7,
  files: {
    'zswap/spend.prover': sha256(contentOf('zswap/7/spend.prover')),
    'zswap/spend.verifier': sha256(contentOf('zswap/7/spend.verifier')),
    'zswap/spend.bzkir': sha256(contentOf('zswap/7/spend.bzkir')),
    'zswap/output.prover': sha256(contentOf('zswap/7/output.prover')),
    'zswap/output.verifier': sha256(contentOf('zswap/7/output.verifier')),
    'zswap/output.bzkir': sha256(contentOf('zswap/7/output.bzkir')),
    'zswap/sign.prover': sha256(contentOf('zswap/7/sign.prover')),
    'zswap/sign.verifier': sha256(contentOf('zswap/7/sign.verifier')),
    'zswap/sign.bzkir': sha256(contentOf('zswap/7/sign.bzkir')),
    'dust/spend.prover': sha256(contentOf('dust/7/spend.prover')),
    'dust/spend.verifier': sha256(contentOf('dust/7/spend.verifier')),
    'dust/spend.bzkir': sha256(contentOf('dust/7/spend.bzkir')),
  },
  params: { 3: sha256(contentOf('bls_midnight_2p3')) },
};

/** Retries at once, twice: the mechanics under test, without the waiting. */
const retrySchedule = Schedule.recurs(2);

const makeProvider = (descriptor: KeyMaterialDescriptor = testDescriptor) =>
  makeKeyMaterialProvider(descriptor, { source: SOURCE, retrySchedule });

describe('A hash-checked key material provider', () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;

  /** Serves each path's stand-in bytes, unless `answer` says otherwise for that request. */
  const serve = (answer: (path: string, attempt: number) => Promise<Response> | undefined = () => undefined) => {
    globalThis.fetch = (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      const path = url.slice(`${SOURCE}/`.length);
      const attempt = requested.filter((seen) => seen === url).length;
      requested.push(url);
      return answer(path, attempt) ?? Promise.resolve(new Response(new Uint8Array(contentOf(path)), { status: 200 }));
    };
  };

  beforeEach(() => {
    requested.length = 0;
    serve();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const settled = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      (value) => value,
      (error: unknown) => error,
    );

  it('hands back the three files of a circuit once each matches its declared hash', async () => {
    await expect(makeProvider().lookupKey('midnight/zswap/spend')).resolves.toStrictEqual({
      proverKey: contentOf('zswap/7/spend.prover'),
      verifierKey: contentOf('zswap/7/spend.verifier'),
      ir: contentOf('zswap/7/spend.bzkir'),
    });
    expect(requested).toStrictEqual([
      `${SOURCE}/zswap/7/spend.prover`,
      `${SOURCE}/zswap/7/spend.verifier`,
      `${SOURCE}/zswap/7/spend.bzkir`,
    ]);
  });

  it('reads a circuit once, however often and however concurrently it is asked for', async () => {
    const provider = makeProvider();

    await Promise.all([
      provider.lookupKey('midnight/dust/spend'),
      provider.lookupKey('midnight/dust/spend'),
      provider.lookupKey('midnight/dust/spend'),
    ]);
    await provider.lookupKey('midnight/dust/spend');

    expect(requested).toStrictEqual([
      `${SOURCE}/dust/7/spend.prover`,
      `${SOURCE}/dust/7/spend.verifier`,
      `${SOURCE}/dust/7/spend.bzkir`,
    ]);
  });

  it('checks every file of a circuit, not only the first', async () => {
    const refusal = await settled(
      makeProvider({
        ...testDescriptor,
        files: { ...testDescriptor.files, 'zswap/output.verifier': sha256(contentOf('something else')) },
      }).lookupKey('midnight/zswap/output'),
    );

    expect(refusal).toBeInstanceOf(KeyMaterialIntegrityError);
    expect(refusal).toMatchObject({
      url: `${SOURCE}/zswap/7/output.verifier`,
      expected: sha256(contentOf('something else')),
      actual: sha256(contentOf('zswap/7/output.verifier')),
    });
  });

  it('reads the public parameters for a size once', async () => {
    const provider = makeProvider();

    await expect(provider.getParams(3)).resolves.toStrictEqual(contentOf('bls_midnight_2p3'));
    await expect(provider.getParams(3)).resolves.toStrictEqual(contentOf('bls_midnight_2p3'));

    expect(requested).toStrictEqual([`${SOURCE}/bls_midnight_2p3`]);
  });

  it('asks again when the host could not be reached, and takes the answer once it comes', async () => {
    serve((path, attempt) =>
      path === 'zswap/7/sign.prover' && attempt === 0 ? Promise.reject(new TypeError('fetch failed')) : undefined,
    );

    await expect(makeProvider().lookupKey('midnight/zswap/sign')).resolves.toMatchObject({
      proverKey: contentOf('zswap/7/sign.prover'),
    });
    expect(requested.filter((url) => url === `${SOURCE}/zswap/7/sign.prover`)).toHaveLength(2);
  });

  it('asks again when the host fails, and gives up once its retries are spent', async () => {
    serve(() => Promise.resolve(new Response('unavailable', { status: 503 })));

    const refusal = await settled(makeProvider().lookupKey('midnight/zswap/sign'));

    expect(refusal).toBeInstanceOf(KeyMaterialFetchError);
    expect(refusal).toMatchObject({ url: `${SOURCE}/zswap/7/sign.prover`, status: 503 });
    expect(requested).toStrictEqual([
      `${SOURCE}/zswap/7/sign.prover`,
      `${SOURCE}/zswap/7/sign.prover`,
      `${SOURCE}/zswap/7/sign.prover`,
    ]);
  });

  it('does not hold on to a refusal: a later lookup reads again', async () => {
    const provider = makeProvider();
    serve(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    await expect(provider.lookupKey('midnight/dust/spend')).rejects.toBeInstanceOf(KeyMaterialIntegrityError);

    serve();

    await expect(provider.lookupKey('midnight/dust/spend')).resolves.toMatchObject({
      proverKey: contentOf('dust/7/spend.prover'),
    });
  });
});

describe('The key material each ledger version is pinned to', () => {
  const installedVersionOf = (packageName: string): string => {
    const entry = createRequire(import.meta.url).resolve(packageName);
    const manifest: unknown = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf-8'));
    return typeof manifest === 'object' && manifest !== null && 'version' in manifest ? String(manifest.version) : '';
  };

  it.each([
    ['ledger-v9', V9KeyMaterial],
    ['ledger-v8', V8KeyMaterial],
  ] as const)('was copied from the %s release that is installed', (_, descriptor) => {
    const { packageName, version, tag } = descriptor.ledgerRelease;

    expect(
      installedVersionOf(packageName),
      `${packageName} is no longer ${version}, the release (midnight-ledger ${tag}) its key material pins were copied ` +
        `from. A ledger release can change its circuits, as ledger-v9 1.0.0-rc.4 changed the Dust spend circuit. ` +
        `Compare the new release's static/version (the circuit generation), ledger/static/dust/*.sha256, ` +
        `zswap/static/*.sha256 and the parameter hashes in base-crypto/src/data_provider.rs with KeyMaterial.ts, ` +
        `update what differs, then update ledgerRelease.`,
    ).toBe(version);
  });
});
