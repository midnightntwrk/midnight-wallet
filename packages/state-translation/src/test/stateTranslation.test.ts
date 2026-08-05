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
 * The wallet side of the state translation, tested against stub modules rather than the real WASM one.
 *
 * Everything here is the adapter's own behaviour — resolving a module, checking it exposes a translation, reporting
 * what went wrong — and none of it needs the translation to exist. The `fixtures/` directory holds real ES modules
 * shaped like the WASM one, so these tests drive the actual dynamic-import path instead of standing in for it.
 *
 * That the _real_ translation produces valid post-fork state is a different question, and is checked where the fork is:
 * `forkStateTranslation.integration.test.ts` in `@midnightntwrk/wallet-sdk-capabilities`.
 */

import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DefaultTranslationModule,
  StateTranslationFailedError,
  StateTranslationUnavailableError,
  TranslationModuleEnvVar,
  createLedgerStateTranslation,
  isLedgerStateTranslationAvailable,
  resolveTranslationModule,
} from '../index.js';

/** Absolute path to a stub module, which is what the environment variable holds for a locally built artifact. */
const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Stands in for serialized pre-fork ledger state; the stub translations reverse it. */
const preForkLedger = new Uint8Array([1, 2, 3, 4]);
const reversed = new Uint8Array([4, 3, 2, 1]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createLedgerStateTranslation', () => {
  it('translates through the export name wasm-bindgen produces', async () => {
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('translation.mjs') });

    expect(await translate(preForkLedger)).toEqual(reversed);
  });

  it('accepts the camelCase export name too', async () => {
    // Whether the WASM export is snake_case or camelCase is the ledger side's choice, and either has to work.
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('camelCaseTranslation.mjs') });

    expect(await translate(preForkLedger)).toEqual(reversed);
  });

  it('awaits a translation that completes asynchronously', async () => {
    // The real translation runs an incremental, cost-metered loop; driving it to completion may have to yield.
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('asyncTranslation.mjs') });

    expect(await translate(preForkLedger)).toEqual(reversed);
  });

  it('reports an unloadable module as unavailable, naming what to do about it', async () => {
    const moduleSpecifier = fixture('noSuchTranslation.mjs');
    const translate = createLedgerStateTranslation({ moduleSpecifier });

    const error = await translate(preForkLedger).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StateTranslationUnavailableError);
    expect(error).toBeInstanceOf(Error);
    const unavailable = error as StateTranslationUnavailableError;
    expect(unavailable.moduleSpecifier).toBe(moduleSpecifier);
    // The artifact is built rather than installed, so an absent module is the expected state and the message has to say
    // how to produce one rather than just that it is missing.
    expect(unavailable.message).toContain('build:wasm');
    expect(unavailable.message).toContain(TranslationModuleEnvVar);
    expect(unavailable.cause).toBeDefined();
  });

  it('reports a module without a translation as unavailable', async () => {
    // Loadable but not a translation: the same failure as absent, since nothing can be translated either way.
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('withoutTranslation.mjs') });

    const error = await translate(preForkLedger).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StateTranslationUnavailableError);
    expect((error as StateTranslationUnavailableError).message).toContain('translate_ledger_state');
  });

  it('reports a translation that throws as a failure, keeping its cause', async () => {
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('throwingTranslation.mjs') });

    const error = await translate(preForkLedger).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StateTranslationFailedError);
    // The WASM module's own error is what says why, so it must survive as the cause.
    expect((error as StateTranslationFailedError).cause).toBeInstanceOf(Error);
    expect(((error as StateTranslationFailedError).cause as Error).message).toBe('state is not translatable');
  });

  it('reports a translation that rejects as a failure', async () => {
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('rejectingTranslation.mjs') });

    const error = await translate(preForkLedger).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StateTranslationFailedError);
    expect(((error as StateTranslationFailedError).cause as Error).message).toBe('translation loop gave up');
  });

  it('rejects a translation that does not return bytes', async () => {
    // Bytes are the contract. Anything else cannot be deserialized downstream, so it fails here where the module that
    // produced it is still named, rather than as an opaque deserialization error later.
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('nonBytesTranslation.mjs') });

    const error = await translate(preForkLedger).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StateTranslationFailedError);
    expect((error as StateTranslationFailedError).cause).toBeInstanceOf(TypeError);
  });

  it('does not touch its input', async () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('translation.mjs') });

    await translate(original);

    expect(original).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

describe('module resolution', () => {
  it('takes the module from the environment when no specifier is given', async () => {
    // How an artifact built somewhere other than this package is used.
    vi.stubEnv(TranslationModuleEnvVar, fixture('translation.mjs'));

    expect(await createLedgerStateTranslation()(preForkLedger)).toEqual(reversed);
    expect(resolveTranslationModule()).toBe(fixture('translation.mjs'));
  });

  it('prefers an explicit specifier over the environment', async () => {
    vi.stubEnv(TranslationModuleEnvVar, fixture('withoutTranslation.mjs'));

    const translate = createLedgerStateTranslation({ moduleSpecifier: fixture('translation.mjs') });

    expect(await translate(preForkLedger)).toEqual(reversed);
    expect(resolveTranslationModule({ moduleSpecifier: fixture('translation.mjs') })).toBe(fixture('translation.mjs'));
  });

  it('falls back to this package’s own build when the environment is unset', () => {
    vi.unstubAllEnvs();

    expect(resolveTranslationModule()).toBe(DefaultTranslationModule);
  });

  it('treats an empty environment variable as unset', () => {
    // An empty variable must not be read as a module path — resolution is asserted directly rather than through a load,
    // since whether the default artifact happens to be built is not this test's business.
    vi.stubEnv(TranslationModuleEnvVar, '');

    expect(resolveTranslationModule()).toBe(DefaultTranslationModule);
  });

  it('defaults to the artifact the build script produces', () => {
    // The contract between the loader and scripts/build-wasm.sh: if these drift, a freshly built artifact is invisible.
    expect(DefaultTranslationModule).toMatch(/^file:\/\//);
    expect(DefaultTranslationModule).toContain('/wasm/pkg/v8_to_v9_state_translation_wasm.js');
  });
});

describe('isLedgerStateTranslationAvailable', () => {
  it('is true for a module exposing a translation', async () => {
    expect(await isLedgerStateTranslationAvailable({ moduleSpecifier: fixture('translation.mjs') })).toBe(true);
  });

  it('is false when the module cannot be loaded', async () => {
    expect(await isLedgerStateTranslationAvailable({ moduleSpecifier: fixture('noSuchTranslation.mjs') })).toBe(false);
  });

  it('is false when the module has no translation', async () => {
    expect(await isLedgerStateTranslationAvailable({ moduleSpecifier: fixture('withoutTranslation.mjs') })).toBe(false);
  });

  it('answers without translating anything', async () => {
    // It is asked in order to decide whether a test can run at all, so it must not need a state to translate.
    expect(await isLedgerStateTranslationAvailable({ moduleSpecifier: fixture('throwingTranslation.mjs') })).toBe(true);
  });
});
