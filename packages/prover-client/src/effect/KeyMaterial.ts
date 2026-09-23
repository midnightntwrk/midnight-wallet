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
 * The key material each ledger version's circuits were generated with, and a provider that reads it and checks it.
 *
 * @remarks
 *   A node verifies a proof against the verifier keys of the circuit generation its ledger version was built with, so a
 *   proof has to be made with that generation's key material, byte for byte. Which generation that is, and what every
 *   file of it hashes to, is declared by the ledger release itself (`midnight-ledger`: `static/version`,
 *   `ledger/static/dust/*.sha256`, `zswap/static/*.sha256`, and the parameter hashes in `base-crypto`'s data provider);
 *   the descriptors below are copies of those declarations, one per ledger version. Nothing at runtime can re-derive
 *   them: the published ledger packages neither expose the generation nor embed the Dust spend verifier key.
 */
import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import { Cache, Cause, Data, Duration, Effect, Exit, Option, Record as ERecord, Schedule, pipe } from 'effect';

/** The host the ledger's own data provider reads key material from: its `MIDNIGHT_PARAM_SOURCE` default. */
export const DefaultKeyMaterialSource = 'https://srs.midnight.network/';

/** A circuit whose key material the ledger resolves by location, named as the host lays it out. */
export type Circuit = 'zswap/spend' | 'zswap/output' | 'zswap/sign' | 'dust/spend';

/** The three files a circuit's key material is made of. */
type KeyFileKind = 'prover' | 'verifier' | 'bzkir';

/** One file of one circuit's key material, named as the ledger names its hash (`<family>/<name>.<kind>`). */
export type KeyFile = `${Circuit}.${KeyFileKind}`;

/** A SHA-256 digest, as lowercase hex. */
type Sha256 = string;

/**
 * The key material one ledger version's circuits were generated with.
 *
 * @remarks
 *   A copy of what one ledger release declares. `ledgerRelease` records which: the pins hold for that release, and a test
 *   compares it with the ledger package installed, so that a ledger upgrade cannot leave them behind unnoticed.
 */
export type KeyMaterialDescriptor = Readonly<{
  /** The ledger release the pins were copied from: its npm package and version, and its `midnight-ledger` tag. */
  ledgerRelease: Readonly<{ packageName: string; version: string; tag: string }>;
  /** The circuit generation the ledger's key locations resolve to (`static/version`). */
  generation: number;
  /** What each file of each circuit hashes to. */
  files: Readonly<Record<KeyFile, Sha256>>;
  /** What the public parameters for each size `k` hash to. */
  params: Readonly<Record<number, Sha256>>;
}>;

/** The public parameters `bls_midnight_2p<k>`, as `base-crypto` declares them; no ledger release has changed them. */
const publicParameters: Readonly<Record<number, Sha256>> = {
  0: '59b30b3114a34ccbbfb599376e178fb8d9b3366cae2174c2f1da20e75847f823',
  1: 'bbe04fe3c70d0c138447cb086b4baddc30cb8bb2a004114bc02e6f739516280e',
  2: '80e15568fa1a0117db893239be7fa5e34a6bcc3a8c3bfa7709534b9cb88eb6c1',
  3: '4be827a6472193df80d8f08b4b25a85baef436fdd1965d89b6af89f4ec4e99e2',
  4: '232f401fad10c7ddf8828d2aa4c85c6506c5da09795998cecaeb9f75fc8f6ada',
  5: '0a1c9229f315fc1868ff25f668fb83aec4d09f4f23a706b5197c692c619d72c6',
  6: 'cf2ad6be7d0fedf5bec2aaa35f6be4aca33053d74268fdf5aa54fcb2891ea6df',
  7: 'e82ae890c080188355f37feaffe91372584cd810615082d9143d4dec0453fd9d',
  8: '909b707551eaaea79828e883cde6fc46ab15986c3b1d791bed462c9e2805c933',
  9: 'b9009f1098bcefffec3c461ab3a5e3a17f7e5599f0f08c70fcdc55a89227bcbd',
  10: '46b2290933cbed4c378889e4ba971f1a92888331ffb09466acd4ff61a1e2cb42',
  11: '9901589d7956ff58be0d85569b2f455b77b58c3758026ffb5bbe4807000b96d1',
  12: 'ef08eb3fcf62df8f72c515cffa027e681808b530cb016eea104115545ef6d5c8',
  13: 'd3324910969c4cc54143b8045b649e5c3a4bd5fb7b8f85fe1b770f640ce1c803',
  14: 'fc253016885ec830e97808c9ec920bb5cab5c21af590380a6cb5eb0538e2b244',
  15: '724c7c3d779148bb113c7ee9c034b2f27db16e6bdf315fde90105a9bad00b1de',
  16: '09c877216d6589b370263e18af40a030a901b41a7a7c37ef58c9901db41f05c6',
  17: '4a9ef6c7c0619aab74eede44b13e753e3ba54508a02dd3b7106a949aabb73b74',
  18: 'e8436dc5d8b598f169c127c745135d889744007e6d384ff126df8d1332522f86',
  19: '8e8dc15c4362f05c912f1e770559a3945db3e58a374def416ed5d3e65ad5b10e',
  20: '1cc62978558fdc1e445cd70cfd9a86ec3c2e2151b6d74811232d37faf9133ff1',
  21: '9cf1644a87f0f027ae5fc6278f91d823a6334ff3e338a29e2f2ef57d071ed64d',
  22: 'e8ad5eed936d657a0fb59d2a55ba19f81a3083bb3554ef88f464f5377e9b2c2f',
  23: '09399d05f9f50875dfdd87dc9903d40c897eaafa9ec8cbb08bace853ecc36c0c',
  24: 'b0e6fa7a4ab4a79a1e6560966f267556409db44bab6d5fab3711ad6c6b623207',
  25: '3289a751c938988cd2f54154d8722d1eda2cd11593064afdde82099b24ff4a58',
};

/** Zswap's key material: the same bytes in circuit generations 9 and 10. */
const zswapFiles = {
  'zswap/spend.prover': '19d234b5c68b7212ad6b0ec9334a95594748154128f3704eb576bcc843cc5c45',
  'zswap/spend.verifier': '544554effd7ae9fb9063be52a9ec2a986756301071fcd97bb4598fb45a335658',
  'zswap/spend.bzkir': '7cb5bbcf67cb212a3336fb439a77e8f32f0aa8a56185c8e1247d6cbfc7300205',
  'zswap/output.prover': 'd992b04f13c3fd432f55fb8bfe6466d87bc181f1a2acf233ec228030bbdd4ed8',
  'zswap/output.verifier': '72e8074856f2f5c504ade25a86a2b8902c64aeb9497c4c8e6b26dea842a0ab08',
  'zswap/output.bzkir': '91dc8b401dd8385e8d29eaac018c70b578505f48c7952452ef319bc397fa1f1b',
  'zswap/sign.prover': 'fe7268dd2bdd107f862f881ac3c5bc71a6df77ce80bfed51cf71514648e660e0',
  'zswap/sign.verifier': 'e39a727caa0de167e6dd6122a9e3b758fecf48f9093ab77c0309648de8ce07e1',
  'zswap/sign.bzkir': '37ea2094516e145a738126307cf92bd293f7cb524b1ccd49fa6f3225a9ec3a50',
} as const;

/** Ledger-v9's key material: circuit generation 10, as `midnight-ledger` `ledger-9.1.0.0-rc.5` declares it. */
export const V9KeyMaterial: KeyMaterialDescriptor = {
  ledgerRelease: { packageName: '@midnightntwrk/ledger-v9', version: '1.0.0-rc.5', tag: 'ledger-9.1.0.0-rc.5' },
  generation: 10,
  files: {
    ...zswapFiles,
    'dust/spend.prover': '3dff9f54add761350ad02621a425d67fe3d656c8145fef8ef147870489ffdc81',
    'dust/spend.verifier': 'd15a1295780549f534287a39c938005e1faa3232be21861573bd0cdb148949cb',
    'dust/spend.bzkir': 'd211cacb22391b9db60f945787d98c16d344cbb4790246132117084c080399c1',
  },
  params: publicParameters,
};

/** Ledger-v8's key material: circuit generation 9, as `midnight-ledger` `ledger-8.1.0` declares it. */
export const V8KeyMaterial: KeyMaterialDescriptor = {
  ledgerRelease: { packageName: '@midnight-ntwrk/ledger-v8', version: '8.1.0', tag: 'ledger-8.1.0' },
  generation: 9,
  files: {
    ...zswapFiles,
    'dust/spend.prover': '996602da7ca386284e656c78ea03e55bffdba29475e6a67965c50de05e13efc2',
    'dust/spend.verifier': '3f1569ebcab0655c5c145b28947c74edc4e3f5c6b276e4404b661cf0905b49d3',
    'dust/spend.bzkir': '904181287e75b0fb596ba5fcc116c882ee5d28e3115304c93ebd913722ce5841',
  },
  params: publicParameters,
};

/** Raised when a key material file does not hash to what the ledger release declares for it. */
export class KeyMaterialIntegrityError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-prover-client/effect/KeyMaterial/KeyMaterialIntegrityError',
)<{
  readonly message: string;
  /** The file whose bytes did not match. */
  readonly url: string;
  /** What the ledger release declares the file hashes to. */
  readonly expected: string;
  /** What the bytes received hash to. */
  readonly actual: string;
}> {}

/** Raised when the host answers a request for key material with anything but success. */
export class KeyMaterialFetchError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-prover-client/effect/KeyMaterial/KeyMaterialFetchError',
)<{
  readonly message: string;
  /** The file that was asked for. */
  readonly url: string;
  /** The HTTP status the host answered with. */
  readonly status: number;
}> {}

/**
 * Raised when no complete answer arrives for a request for key material: the host was unreachable, or the transfer
 * broke off.
 */
export class KeyMaterialTransferError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-prover-client/effect/KeyMaterial/KeyMaterialTransferError',
)<{
  readonly message: string;
  /** The file that was asked for. */
  readonly url: string;
  readonly cause: unknown;
}> {}

/** Raised when public parameters are asked for at a size `k` the ledger does not publish. */
export class UnknownPublicParametersError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-prover-client/effect/KeyMaterial/UnknownPublicParametersError',
)<{
  readonly message: string;
  /** The size that was asked for. */
  readonly k: number;
}> {}

/** Everything reading key material can fail with. */
export type KeyMaterialError =
  KeyMaterialIntegrityError | KeyMaterialFetchError | KeyMaterialTransferError | UnknownPublicParametersError;

/** How a provider reads key material. */
export type KeyMaterialProviderOptions = Readonly<{
  /** Where to read from. A path is kept: `https://example.com/keys` reads `https://example.com/keys/dust/…`. */
  source: URL | string;
  /** How often, and how far apart, to ask again after a failure that may pass. */
  retrySchedule?: Schedule.Schedule<unknown, unknown>;
}>;

/** Four more attempts after the first, one, two, four and eight seconds apart. */
const defaultRetrySchedule = pipe(Schedule.exponential(Duration.seconds(1), 2), Schedule.intersect(Schedule.recurs(4)));

/** Room for every circuit and every parameter size a descriptor names. */
const cacheCapacity = 64;

const circuitsByKeyLocation: Readonly<Record<string, Circuit>> = {
  'midnight/zswap/spend': 'zswap/spend',
  'midnight/zswap/output': 'zswap/output',
  'midnight/zswap/sign': 'zswap/sign',
  'midnight/dust/spend': 'dust/spend',
};

/** A failure that asking again may cure: no complete answer, a server error, or being asked to slow down. */
const mayPass = (error: KeyMaterialFetchError | KeyMaterialTransferError): boolean =>
  error instanceof KeyMaterialTransferError || error.status >= 500 || error.status === 429;

/** Resolves a path against the source, keeping any path the source has. */
const sourceBase = (source: URL | string): URL => {
  const href = source.toString();
  return new URL(href.endsWith('/') ? href : `${href}/`);
};

const fetchBytes = (
  url: URL,
): Effect.Effect<Uint8Array<ArrayBuffer>, KeyMaterialFetchError | KeyMaterialTransferError> =>
  pipe(
    Effect.tryPromise({
      try: (signal) => globalThis.fetch(url, { signal }),
      catch: (cause) =>
        new KeyMaterialTransferError({
          message: `Could not fetch ${url.href}: ${String(cause)}`,
          url: url.href,
          cause,
        }),
    }),
    Effect.filterOrFail(
      (response) => response.ok,
      (response) =>
        new KeyMaterialFetchError({
          message: `${url.href} answered ${response.status}${response.statusText === '' ? '' : ` ${response.statusText}`}`,
          url: url.href,
          status: response.status,
        }),
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: (cause) =>
          new KeyMaterialTransferError({
            message: `The transfer of ${url.href} broke off: ${String(cause)}`,
            url: url.href,
            cause,
          }),
      }),
    ),
    Effect.map((buffer) => new Uint8Array(buffer)),
  );

const sha256Of = (bytes: Uint8Array<ArrayBuffer>): Effect.Effect<Sha256> =>
  pipe(
    Effect.promise(() => globalThis.crypto.subtle.digest('SHA-256', bytes)),
    Effect.map((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')),
  );

/** Reads one file, asking again while the failure may pass, and hands it back only if it hashes to `expected`. */
const fetchVerified = (
  url: URL,
  expected: Sha256,
  retrySchedule: Schedule.Schedule<unknown, unknown>,
): Effect.Effect<
  Uint8Array<ArrayBuffer>,
  KeyMaterialIntegrityError | KeyMaterialFetchError | KeyMaterialTransferError
> =>
  pipe(
    fetchBytes(url),
    Effect.tapError((error) =>
      mayPass(error) ? Effect.logWarning(`${error.message} (asking again while retries remain)`) : Effect.void,
    ),
    Effect.retry({ schedule: retrySchedule, while: mayPass }),
    Effect.flatMap((bytes) =>
      pipe(
        sha256Of(bytes),
        Effect.filterOrFail(
          (actual) => actual === expected,
          (actual) =>
            new KeyMaterialIntegrityError({
              message: `${url.href} hashes to ${actual}, but the ledger release declares ${expected}`,
              url: url.href,
              expected,
              actual,
            }),
        ),
        Effect.as(bytes),
      ),
    ),
  );

/**
 * Runs a read at the Promise boundary the zkir runtime calls through, rejecting with the error itself rather than
 * Effect's wrapper around it.
 */
const runAtBoundary = <A>(effect: Effect.Effect<A, KeyMaterialError>): Promise<A> =>
  Effect.runPromiseExit(effect).then(
    Exit.match({
      onSuccess: (value) => Promise.resolve(value),
      onFailure: (cause) => {
        const error = Cause.squash(cause);
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      },
    }),
  );

/**
 * Reads through a cache that keeps what was read for good but forgets a failure at once, so that the next request reads
 * again. The failure is dropped explicitly: a cache entry that expires "now" can still be served within the same
 * instant.
 */
const readThrough = <K, A>(cache: Cache.Cache<K, A, KeyMaterialError>, key: K): Effect.Effect<A, KeyMaterialError> =>
  pipe(
    cache.get(key),
    Effect.tapError(() => cache.invalidate(key)),
  );

/**
 * A key material provider for the ledger version a descriptor describes.
 *
 * @remarks
 *   Every file is checked against the descriptor before it is handed back, and kept once it has been: a circuit or a
 *   parameter size is read once per provider, however often and however concurrently it is asked for. A failure is not
 *   kept. Checking needs Web Crypto (`crypto.subtle`): Node 19 or later, or a browser page served from a secure
 *   context.
 * @param descriptor The key material to read, and what each file must hash to.
 * @param options Where to read from, and how to retry.
 * @returns A provider for the zkir runtime. Its lookups reject with a {@link KeyMaterialError}.
 * @throws TypeError if `options.source` is not a URL.
 */
export const makeKeyMaterialProvider = (
  descriptor: KeyMaterialDescriptor,
  options: KeyMaterialProviderOptions,
): KeyMaterialProvider => {
  const base = sourceBase(options.source);
  const retrySchedule = options.retrySchedule ?? defaultRetrySchedule;

  const readFile = (circuit: Circuit, kind: KeyFileKind): Effect.Effect<Uint8Array<ArrayBuffer>, KeyMaterialError> => {
    const file: KeyFile = `${circuit}.${kind}`;
    const path = `${circuit.replace('/', `/${descriptor.generation}/`)}.${kind}`;
    return fetchVerified(new URL(path, base), descriptor.files[file], retrySchedule);
  };

  const readCircuit = (circuit: Circuit): Effect.Effect<ProvingKeyMaterial, KeyMaterialError> =>
    Effect.all({
      proverKey: readFile(circuit, 'prover'),
      verifierKey: readFile(circuit, 'verifier'),
      ir: readFile(circuit, 'bzkir'),
    });

  const readParams = (k: number): Effect.Effect<Uint8Array, KeyMaterialError> =>
    Option.match(Option.fromNullable(descriptor.params[k]), {
      onNone: () =>
        Effect.fail(
          new UnknownPublicParametersError({
            message: `The ledger publishes no public parameters for k = ${k}`,
            k,
          }),
        ),
      onSome: (expected) => fetchVerified(new URL(`bls_midnight_2p${k}`, base), expected, retrySchedule),
    });

  const circuits = Effect.runSync(
    Cache.make({ capacity: cacheCapacity, timeToLive: Duration.infinity, lookup: readCircuit }),
  );
  const params = Effect.runSync(
    Cache.make({ capacity: cacheCapacity, timeToLive: Duration.infinity, lookup: readParams }),
  );

  return {
    lookupKey: (keyLocation) =>
      Option.match(ERecord.get(circuitsByKeyLocation, keyLocation), {
        onNone: () => Promise.resolve(undefined),
        onSome: (circuit) => runAtBoundary(readThrough(circuits, circuit)),
      }),
    getParams: (k) => runAtBoundary(readThrough(params, k)),
  };
};
