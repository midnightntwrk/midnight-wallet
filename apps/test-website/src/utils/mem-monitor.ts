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

// Periodic memory sampler for the browser memory test page. Produces a
// fixed-width log in the same shape as the CLI `.memdebug/mem-*.log` files,
// with browser heap columns (performance.memory) instead of the Node-only
// ones (rss, external, arrayBuffers) and per-wallet sync progress appended.

import { wasmInstances } from './wasm-monitor.js';

// Normalized progress shape: the shielded/dust wallets report
// appliedIndex/highestRelevantWalletIndex while the unshielded wallet reports
// appliedId/highestTransactionId — callers map either pair onto applied/highest.
export type SyncProgressLike = {
  readonly applied: bigint;
  readonly highest: bigint;
  readonly isConnected: boolean;
};

export type SyncSnapshot = {
  readonly shielded: SyncProgressLike;
  readonly unshielded: SyncProgressLike;
  readonly dust: SyncProgressLike;
  readonly synced: boolean;
};

// Chrome-only, non-standard. Quantized unless the page is cross-origin isolated.
type PerformanceMemory = {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
};

const readHeapMemory = (): PerformanceMemory | undefined =>
  (performance as Performance & { memory?: PerformanceMemory }).memory;

// Fixed-width columns so the header and data rows line up regardless of value
// length (tabs don't align because the column names vary in width).
const COLUMNS: ReadonlyArray<readonly [name: string, width: number]> = [
  ['timestamp', 24],
  ['heap_used_MB', 12],
  ['heap_total_MB', 13],
  ['heap_limit_MB', 13],
  ['wasm_MB', 8],
  ['wasm_count', 10],
  ['wasm_per_instance_MB', 20],
  ['shielded_sync', 14],
  ['unshielded_sync', 16],
  ['dust_sync', 14],
  ['synced', 6],
];

const formatRow = (cells: ReadonlyArray<string | number>): string =>
  cells
    .map((c, i) => String(c).padEnd(COLUMNS[i]?.[1] ?? 0))
    .join('  ')
    .trimEnd();

export const memLogHeader = formatRow(COLUMNS.map(([name]) => name));

export const formatMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

export const formatSync = (progress: SyncProgressLike | undefined): string =>
  progress !== undefined && progress.isConnected ? `${progress.applied}/${progress.highest}` : '-';

export type MemSample = {
  readonly timestamp: string;
  readonly heap: PerformanceMemory | undefined;
  readonly wasmTotalBytes: number;
  readonly wasmPerInstanceBytes: readonly number[];
  readonly sync: SyncSnapshot | undefined;
};

const takeSample = (sync: SyncSnapshot | undefined): MemSample => ({
  timestamp: new Date().toISOString(),
  heap: readHeapMemory(),
  wasmTotalBytes: wasmInstances.reduce((sum, t) => sum + t.mem.buffer.byteLength, 0),
  wasmPerInstanceBytes: wasmInstances.map((t) => t.mem.buffer.byteLength),
  sync,
});

export const sampleRow = (sample: MemSample): string => {
  const { heap, sync } = sample;
  const wasmBreakdown = sample.wasmPerInstanceBytes.map(formatMB).join('|');
  return formatRow([
    sample.timestamp,
    heap !== undefined ? formatMB(heap.usedJSHeapSize) : 'n/a',
    heap !== undefined ? formatMB(heap.totalJSHeapSize) : 'n/a',
    heap !== undefined ? formatMB(heap.jsHeapSizeLimit) : 'n/a',
    formatMB(sample.wasmTotalBytes),
    sample.wasmPerInstanceBytes.length,
    wasmBreakdown.length > 0 ? wasmBreakdown : '-',
    formatSync(sync?.shielded),
    formatSync(sync?.unshielded),
    formatSync(sync?.dust),
    sync !== undefined ? String(sync.synced) : '-',
  ]);
};

// Mutable singleton store: debug instrumentation state (log buffer, listener
// registry, interval handle), deliberately isolated in this module. The
// `lines`/`rows` arrays are replaced immutably on every append so React's
// useSyncExternalStore sees fresh snapshot references.
//
// `lines` is the full log (preamble, header, wasm capture lines, data rows)
// used for the downloaded file; `rows` holds only the data rows for the UI,
// which renders the header separately as a sticky bar.
const store = {
  lines: [] as readonly string[],
  rows: [] as readonly string[],
  latest: undefined as MemSample | undefined,
  listeners: new Set<() => void>(),
  intervalId: undefined as number | undefined,
  seenWasmCount: 0,
};

const notify = (): void => {
  store.listeners.forEach((listener) => listener());
};

const appendMeta = (metaLines: readonly string[]): void => {
  store.lines = [...store.lines, ...metaLines];
};

const appendRow = (row: string): void => {
  store.lines = [...store.lines, row];
  store.rows = [...store.rows, row];
};

// Wasm instances captured since the previous tick, reported like the CLI
// wasm-monitor does so instance index → module can be matched by exports.
const newCaptureLines = (): readonly string[] =>
  wasmInstances
    .slice(store.seenWasmCount)
    .map(
      (t) =>
        `[wasm-monitor] ${t.label} captured (initial=${formatMB(t.mem.buffer.byteLength)} MB) exports: ${t.sampleExports.join(', ')}`,
    );

const tick = (getSync: () => SyncSnapshot | undefined): void => {
  appendMeta(newCaptureLines());
  store.seenWasmCount = wasmInstances.length;
  store.latest = takeSample(getSync());
  appendRow(sampleRow(store.latest));
  notify();
};

export const startMemMonitor = (getSync: () => SyncSnapshot | undefined, intervalMs = 10_000): void => {
  if (store.intervalId !== undefined) {
    return;
  }
  appendMeta([
    `started=${new Date().toISOString()} crossOriginIsolated=${String(globalThis.crossOriginIsolated)} userAgent=${navigator.userAgent}`,
    memLogHeader,
  ]);
  tick(getSync);
  store.intervalId = window.setInterval(() => tick(getSync), intervalMs);
};

export const stopMemMonitor = (): void => {
  if (store.intervalId !== undefined) {
    window.clearInterval(store.intervalId);
    store.intervalId = undefined;
  }
};

export const subscribeMemLog = (listener: () => void): (() => void) => {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
};

export const getMemLogLines = (): readonly string[] => store.lines;

export const getMemLogRows = (): readonly string[] => store.rows;

export const getLatestSample = (): MemSample | undefined => store.latest;

export const downloadMemLog = (): void => {
  const blob = new Blob([`${store.lines.join('\n')}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mem-${Date.now()}.log`;
  anchor.click();
  URL.revokeObjectURL(url);
};
