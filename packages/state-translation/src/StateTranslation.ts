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
 * Loading the ledger-side v8-to-v9 ledger state translation and running it.
 *
 * The translation is Rust, compiled to WASM out of the `midnight-ledger` repository, and it is the only thing that can
 * convert a pre-fork ledger state into a post-fork one: it links both ledgers at once, which nothing on the JavaScript
 * side can do. This module is the whole of the wallet side — resolve that module, check it exposes a translation, hand
 * it bytes, hand bytes back.
 *
 * Two deliberate shapes:
 *
 * - **Bytes in, bytes out.** Neither ledger's state objects exist in the other's WASM module, so serialized state is the
 *   only thing that crosses. Both ledgers' `LedgerState.serialize()` emits the tagged framing the translation consumes
 *   (`midnight:ledger-state[v13]` for v8, `[v18]` for v9), so no reframing is needed here.
 * - **A `Promise` that rejects, not an `Either`.** This package is a boundary onto a WASM module that signals failure by
 *   throwing, and its one consumer is `translatorFromAsync` in `@midnightntwrk/wallet-sdk-capabilities`, which wants
 *   exactly `(bytes) => Promise<Uint8Array>`. The `Effect`-shaped seam lives there; this side stays a thin adapter with
 *   no dependencies.
 *
 * The module is resolved at call time rather than import time, so importing this package is free even where the
 * translation is not installed, and {@link isLedgerStateTranslationAvailable} can answer without committing to a
 * translation.
 */

/**
 * Where `scripts/build-wasm.sh` puts the WASM artifact, relative to this module.
 *
 * The WASM bindings are built from this package's own `wasm/` crate rather than installed, so the default is a path
 * into this package and not a package name. Both `src/` and `dist/` sit one level below the package root, so the same
 * relative path serves compiled and uncompiled callers.
 */
const BuiltModulePath = '../wasm/pkg/v8_to_v9_state_translation_wasm.js';

/** Absolute specifier of the locally built translation, resolved against this module's location. */
export const DefaultTranslationModule = new URL(BuiltModulePath, import.meta.url).href;

/**
 * Environment variable holding the module specifier to load the translation from, overriding
 * {@link DefaultTranslationModule}.
 *
 * For pointing at an artifact built somewhere else — another checkout, or the published package once it exists. The
 * ordinary local flow needs no environment at all: build it in place with `yarn build:wasm`.
 */
export const TranslationModuleEnvVar = 'MIDNIGHT_V8_TO_V9_STATE_TRANSLATION';

/**
 * The translation module could not be loaded, or does not expose a translation function.
 *
 * Distinct from {@link StateTranslationFailedError}: nothing was translated, and nothing was even attempted. This is
 * what a missing or wrongly-pointed-at artifact looks like.
 */
export class StateTranslationUnavailableError extends Error {
  override readonly name = 'StateTranslationUnavailableError';

  /** Module specifier that was tried. */
  readonly moduleSpecifier: string;

  constructor(moduleSpecifier: string, detail: string, cause?: unknown) {
    super(
      `The v8-to-v9 ledger state translation is not available from '${moduleSpecifier}': ${detail}. ` +
        `Build it with 'yarn workspace @midnightntwrk/wallet-sdk-state-translation build:wasm', ` +
        `or set ${TranslationModuleEnvVar} to an artifact built elsewhere.`,
      cause === undefined ? undefined : { cause },
    );
    this.moduleSpecifier = moduleSpecifier;
  }
}

/**
 * The translation ran and did not produce a post-fork ledger state.
 *
 * Covers the translation throwing and the translation returning something that is not bytes. Whether the bytes it did
 * return are a _valid_ post-fork state is not decided here — that belongs to whoever deserializes them.
 */
export class StateTranslationFailedError extends Error {
  override readonly name = 'StateTranslationFailedError';

  constructor(cause: unknown) {
    super('The v8-to-v9 ledger state translation failed', { cause });
  }
}

/** Options for {@link createLedgerStateTranslation}. */
export type LedgerStateTranslationOptions = Readonly<{
  /**
   * Module specifier to load the translation from.
   *
   * Defaults to {@link TranslationModuleEnvVar} if it is set and non-empty, and to {@link DefaultTranslationModule} —
   * this package's own built artifact — otherwise.
   */
  moduleSpecifier?: string;
}>;

/**
 * What the WASM module has to provide.
 *
 * The return type is deliberately loose: the translation runs an incremental, cost-metered loop internally, and whether
 * driving it to completion needs to yield is the ledger side's call. Awaiting covers both.
 */
type Translate = (preForkLedger: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/**
 * Names the translation export may go by.
 *
 * `wasm-bindgen` keeps the Rust function name, so `translate_ledger_state` is what the specified crate produces. The
 * camelCase spelling is accepted too — the export name is the ledger side's choice, and not worth a round trip.
 */
const translationExportNames = ['translate_ledger_state', 'translateLedgerState'] as const;

/** Pick the translation out of a loaded module, or nothing if it does not have one. */
const parseTranslate = (loaded: unknown): Translate | undefined => {
  if (typeof loaded !== 'object' || loaded === null) return undefined;
  // Cast required because: the value is the result of a dynamic `import()` of a specifier chosen at runtime, so it is
  // untyped by construction. This is the single place the module's shape is checked, and the `typeof` guard below is
  // what actually establishes it.
  const exports = loaded as Partial<Record<string, Translate>>;
  return translationExportNames.map((name) => exports[name]).find((member) => typeof member === 'function');
};

/** Resolve and load the translation, failing with {@link StateTranslationUnavailableError} if it is not there. */
const loadTranslate = async (moduleSpecifier: string): Promise<Translate> => {
  const loaded: unknown = await import(moduleSpecifier).catch((cause: unknown) => {
    throw new StateTranslationUnavailableError(moduleSpecifier, 'the module could not be loaded', cause);
  });

  const translate = parseTranslate(loaded);
  if (translate === undefined) {
    throw new StateTranslationUnavailableError(
      moduleSpecifier,
      `the module exports none of ${translationExportNames.map((name) => `'${name}'`).join(' or ')}`,
    );
  }
  return translate;
};

/**
 * Which module the translation will be loaded from: an explicit specifier, else {@link TranslationModuleEnvVar}, else
 * {@link DefaultTranslationModule}.
 *
 * Exposed because the order is part of this package's contract, and because it is the only way to observe the choice
 * without also committing to loading — an empty environment variable must read as unset, which is not otherwise
 * distinguishable from a build that happens to be present.
 *
 * @param options - Overrides to apply
 * @returns The module specifier that would be loaded
 */
export const resolveTranslationModule = (options: LedgerStateTranslationOptions = {}): string => {
  const fromEnvironment = process.env[TranslationModuleEnvVar];
  return (
    options.moduleSpecifier ??
    (fromEnvironment !== undefined && fromEnvironment !== '' ? fromEnvironment : DefaultTranslationModule)
  );
};

/**
 * Build a translation of serialized pre-fork (ledger-v8) ledger state into serialized post-fork (ledger-v9) state.
 *
 * Prefer {@link translateLedgerState} unless the module has to be named explicitly.
 *
 * @example
 *   ```typescript
 *   const translate = createLedgerStateTranslation({ moduleSpecifier: '/path/to/pkg' });
 *   const postFork = v9.LedgerState.deserialize(await translate(preFork.serialize()));
 *   ```;
 *
 * @param options - Where to load the translation from
 * @returns A function from serialized pre-fork state to serialized post-fork state
 */
export const createLedgerStateTranslation =
  (options: LedgerStateTranslationOptions = {}) =>
  async (preForkLedger: Uint8Array): Promise<Uint8Array> => {
    const translate = await loadTranslate(resolveTranslationModule(options));

    // `.then` rather than `try`, so a translation that throws synchronously is reported the same way as one that
    // rejects — from the module's perspective either is how it says "no".
    const translated: Uint8Array | Promise<Uint8Array> = await Promise.resolve()
      .then(() => translate(preForkLedger))
      .catch((cause: unknown) => {
        throw new StateTranslationFailedError(cause);
      });

    if (!(translated instanceof Uint8Array)) {
      throw new StateTranslationFailedError(
        new TypeError(`The translation returned ${typeof translated} rather than serialized ledger state`),
      );
    }
    return translated;
  };

/**
 * Translate a serialized pre-fork (ledger-v8) ledger state into a serialized post-fork (ledger-v9) one.
 *
 * Shaped for `translatorFromAsync` from `@midnightntwrk/wallet-sdk-capabilities`, which is how it reaches a
 * `ForkHandover.TranslateLedger`.
 *
 * @example
 *   ```typescript
 *   const handover = ForkHandover.TranslateLedger({ translator: translatorFromAsync(translateLedgerState) });
 *   ```;
 *
 * @param preForkLedger - A ledger-v8 `LedgerState.serialize()`
 * @returns Bytes a ledger-v9 `LedgerState.deserialize` accepts
 * @throws StateTranslationUnavailableError if the translation module cannot be loaded
 * @throws StateTranslationFailedError if the translation itself fails
 */
export const translateLedgerState = createLedgerStateTranslation();

/**
 * Whether the translation module can be loaded, without translating anything.
 *
 * For deciding whether a test that needs the translation can run: it is not installable from a registry yet, so it is
 * absent unless a local build has been pointed at.
 *
 * @param options - Where to look for the translation
 * @returns True if the module resolves and exposes a translation
 */
export const isLedgerStateTranslationAvailable = (options: LedgerStateTranslationOptions = {}): Promise<boolean> =>
  loadTranslate(resolveTranslationModule(options)).then(
    () => true,
    () => false,
  );
