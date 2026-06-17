/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// MUST be imported before any wallet-sdk / ledger code so the monkey-patch on
// WebAssembly is installed before the ledger wasm modules are instantiated.
//
// ESM resolves and executes imports depth-first in source order, so as long
// as this file's import line comes before any wallet-sdk import in the entry
// point, this side-effect runs first.
//
// This module is debug instrumentation around the inherently mutable
// WebAssembly global — the mutation (patching globals, appending captured
// instances) is intentional and isolated here.

export type TrackedWasm = {
  readonly mem: WebAssembly.Memory;
  readonly label: string;
  readonly sampleExports: readonly string[];
};

const instances: TrackedWasm[] = [];
export const wasmInstances: readonly TrackedWasm[] = instances;

// Heuristic labelling: pick a few distinctive-looking export names to help
// identify which underlying module the instance belongs to (ledger vs zkir
// vs hd, etc.). Read these off the capture entries to match instance → module.
const summarizeExports = (exports: Record<string, unknown>): readonly string[] => {
  const keys = Object.keys(exports);
  const distinctive = keys.filter((k) => !k.startsWith('__') && k !== 'memory' && typeof exports[k] === 'function');
  return (distinctive.length > 0 ? distinctive : keys).slice(0, 6);
};

// Structural check instead of `instanceof WebAssembly.Instance` / parameter
// typing: the ambient WebAssembly types (dom + node overlap) are too loose
// for instanceof/`in` narrowing to work reliably across the patched paths.
type WasmInstanceLike = { readonly exports: Record<string, unknown> };
const isInstanceLike = (value: unknown): value is WasmInstanceLike =>
  typeof value === 'object' && value !== null && 'exports' in value;

const track = (candidate: unknown): void => {
  if (!isInstanceLike(candidate)) {
    return;
  }
  const mem = candidate.exports['memory'];
  if (!(mem instanceof WebAssembly.Memory)) {
    return;
  }
  if (instances.some((t) => t.mem === mem)) {
    return;
  }
  instances.push({
    mem,
    label: `wasm#${instances.length}`,
    sampleExports: summarizeExports(candidate.exports),
  });
};

const OrigInstance = WebAssembly.Instance;
const PatchedInstance = function (module: WebAssembly.Module, imports?: WebAssembly.Imports) {
  const inst = new OrigInstance(module, imports);
  track(inst);
  return inst;
  // Type cast required because: a plain function cannot be typed as a class
  // constructor, but it must remain a wrapper function around `new OrigInstance`.
} as unknown as typeof WebAssembly.Instance;
PatchedInstance.prototype = OrigInstance.prototype;
WebAssembly.Instance = PatchedInstance;

// WebAssembly.instantiate() / instantiateStreaming() create Instances through
// engine-internal paths that do NOT go via the WebAssembly.Instance
// constructor in some engines. Patch them too.
const origInstantiate = WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate = (async (source: WebAssembly.Module | BufferSource, imports?: WebAssembly.Imports) => {
  // Type cast required because: WebAssembly.instantiate has incompatible
  // overloads (BufferSource vs Module) that a single passthrough call site
  // cannot satisfy without selecting one of them.
  const result = await origInstantiate(source, imports);
  track('instance' in result ? result.instance : result);
  return result;
  // Type cast required because: the overloaded signature of
  // WebAssembly.instantiate cannot be expressed as a single function type.
}) as typeof WebAssembly.instantiate;

const origInstantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
WebAssembly.instantiateStreaming = async (
  source: Response | PromiseLike<Response>,
  imports?: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> => {
  const result = await origInstantiateStreaming(source, imports);
  track(result.instance);
  return result;
};
