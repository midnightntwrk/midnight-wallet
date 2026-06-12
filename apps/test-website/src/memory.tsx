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

// IMPORTANT: wasm-monitor must be the FIRST import so its monkey-patch on
// WebAssembly is installed before the ledger wasm modules are instantiated
// (which happens during wallet-sdk import resolution via ./wallet.js).
import './wasm-monitor.js';
import {
  downloadMemLog,
  formatMB,
  formatSync,
  getLatestSample,
  getMemLogRows,
  memLogHeader,
  startMemMonitor,
  subscribeMemLog,
  type SyncSnapshot,
} from './mem-monitor.js';
import * as Wallet from './wallet.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { type Subscription } from 'rxjs';
import { Buffer } from 'buffer';

const randomSeedHex = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');

const SEED_PATTERN = /^[0-9a-fA-F]{64}$/;

type Phase = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const styles = {
  page: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: 1440,
    margin: '0 auto',
    padding: '1.5em',
    color: '#0f172a',
  },
  title: { margin: '0 0 0.25em', fontSize: '1.4em' },
  subtitle: { margin: '0 0 1.5em', color: '#64748b', fontSize: '0.9em' },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '1em 1.25em',
    marginBottom: '1em',
    background: '#ffffff',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
  },
  cardTitle: {
    margin: '0 0 0.75em',
    fontSize: '0.75em',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#64748b',
  },
  row: { display: 'flex', gap: '0.75em', alignItems: 'center', flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.25em', fontSize: '0.85em', color: '#334155' },
  select: { padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.95em' },
  seedInput: {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontFamily: MONO,
    fontSize: '0.85em',
    width: '42em',
    maxWidth: '80vw',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: '0.8em',
    fontWeight: 600,
    color: '#ffffff',
  },
  error: {
    marginTop: '0.75em',
    padding: '0.5em 0.75em',
    borderRadius: 6,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    fontSize: '0.9em',
  },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75em' },
  tile: {
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    padding: '0.5em 0.75em',
    background: '#f8fafc',
    minWidth: 0,
    overflow: 'hidden',
  },
  tileLabel: { fontSize: '0.7em', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' },
  tileValue: { fontFamily: MONO, fontSize: '0.95em', fontWeight: 600, marginTop: '0.2em', wordBreak: 'break-all' },
  logScroll: {
    background: '#0f172a',
    borderRadius: 8,
    maxHeight: '50vh',
    overflow: 'auto',
  },
  logHeader: {
    position: 'sticky',
    top: 0,
    padding: '6px 10px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    color: '#94a3b8',
    fontFamily: MONO,
    fontSize: 12,
    whiteSpace: 'pre',
  },
  logBody: {
    margin: 0,
    padding: '6px 10px',
    color: '#e2e8f0',
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: 'pre',
  },
} satisfies Record<string, React.CSSProperties>;

const PHASE_COLORS: Record<Phase, string> = {
  idle: '#64748b',
  starting: '#d97706',
  running: '#16a34a',
  stopping: '#d97706',
  stopped: '#dc2626',
};

const buttonStyle = (disabled: boolean, accent = false): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 6,
  border: accent ? 'none' : '1px solid #cbd5e1',
  background: accent ? '#2563eb' : '#ffffff',
  color: accent ? '#ffffff' : '#334155',
  fontSize: '0.9em',
  fontWeight: 500,
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1,
});

function StatTiles(): React.ReactElement {
  const latest = React.useSyncExternalStore(subscribeMemLog, getLatestSample);
  const tiles: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'heap used', value: latest?.heap !== undefined ? `${formatMB(latest.heap.usedJSHeapSize)} MB` : '—' },
    { label: 'heap total', value: latest?.heap !== undefined ? `${formatMB(latest.heap.totalJSHeapSize)} MB` : '—' },
    { label: 'wasm total', value: latest !== undefined ? `${formatMB(latest.wasmTotalBytes)} MB` : '—' },
    { label: 'wasm instances', value: latest !== undefined ? String(latest.wasmPerInstanceBytes.length) : '—' },
    { label: 'shielded sync', value: formatSync(latest?.sync?.shielded) },
    { label: 'unshielded sync', value: formatSync(latest?.sync?.unshielded) },
    { label: 'dust sync', value: formatSync(latest?.sync?.dust) },
    { label: 'synced', value: latest?.sync !== undefined ? String(latest.sync.synced) : '—' },
  ];
  return (
    <div style={styles.tiles}>
      {tiles.map((tile) => (
        <div key={tile.label} style={styles.tile}>
          <div style={styles.tileLabel}>{tile.label}</div>
          <div style={styles.tileValue}>{tile.value}</div>
        </div>
      ))}
    </div>
  );
}

function MemLogView(): React.ReactElement {
  const rows = React.useSyncExternalStore(subscribeMemLog, getMemLogRows);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current !== null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows]);

  return (
    <div ref={scrollRef} style={styles.logScroll}>
      <div style={styles.logHeader}>{memLogHeader}</div>
      <pre style={styles.logBody}>
        {rows.length > 0 ? rows.join('\n') : 'No samples yet — start the wallet to begin logging.'}
      </pre>
    </div>
  );
}

function MemoryTest(): React.ReactElement {
  const [network, setNetwork] = React.useState<Wallet.KnownNetwork>('preview');
  const [seedHex, setSeedHex] = React.useState(randomSeedHex);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState<string | undefined>(undefined);
  const walletRef = React.useRef<Awaited<ReturnType<typeof Wallet.init>> | undefined>(undefined);
  const subscriptionRef = React.useRef<Subscription | undefined>(undefined);
  const syncRef = React.useRef<SyncSnapshot | undefined>(undefined);

  const start = async (): Promise<void> => {
    if (!SEED_PATTERN.test(seedHex)) {
      setError('Seed must be exactly 64 hex characters (32 bytes)');
      return;
    }
    setError(undefined);
    setPhase('starting');
    try {
      const initialized = await Wallet.init(Buffer.from(seedHex, 'hex'), Wallet.configurationFor(network));
      walletRef.current = initialized;
      subscriptionRef.current = initialized.wallet.state().subscribe((state) => {
        syncRef.current = {
          shielded: {
            applied: state.shielded.progress.appliedIndex,
            highest: state.shielded.progress.highestRelevantWalletIndex,
            isConnected: state.shielded.progress.isConnected,
          },
          unshielded: {
            applied: state.unshielded.progress.appliedId,
            highest: state.unshielded.progress.highestTransactionId,
            isConnected: state.unshielded.progress.isConnected,
          },
          dust: {
            applied: state.dust.progress.appliedIndex,
            highest: state.dust.progress.highestRelevantWalletIndex,
            isConnected: state.dust.progress.isConnected,
          },
          synced: state.isSynced,
        };
      });
      startMemMonitor(() => syncRef.current);
      setPhase('running');
    } catch (e) {
      setError(String(e));
      setPhase('idle');
    }
  };

  // Stops the wallet but keeps the sampler running: the post-stop tail of the
  // log shows whether heap/wasm memory is actually released on teardown.
  const stop = async (): Promise<void> => {
    setPhase('stopping');
    try {
      subscriptionRef.current?.unsubscribe();
      await walletRef.current?.wallet.stop();
    } catch (e) {
      setError(String(e));
    }
    setPhase('stopped');
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Wallet sync memory test</h1>
      <p style={styles.subtitle}>
        Starts a wallet sync and samples JS heap + wasm memory every 10s, in the same format as the CLI{' '}
        <code>.memdebug/mem-*.log</code> files.
      </p>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Configuration</h2>
        <div style={styles.row}>
          <label style={styles.label}>
            network
            <select
              style={styles.select}
              value={network}
              disabled={phase !== 'idle'}
              onChange={(e) => {
                // Type cast required because: the select only contains KNOWN_NETWORKS
                // options, but the DOM API types e.target.value as plain string.
                setNetwork(e.target.value as Wallet.KnownNetwork);
              }}
            >
              {Wallet.KNOWN_NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            seed (64 hex chars)
            <span style={styles.row}>
              <input
                type="text"
                style={styles.seedInput}
                value={seedHex}
                disabled={phase !== 'idle'}
                onChange={(e) => setSeedHex(e.target.value)}
              />
              <button
                style={buttonStyle(phase !== 'idle')}
                disabled={phase !== 'idle'}
                onClick={() => setSeedHex(randomSeedHex())}
              >
                randomize
              </button>
            </span>
          </label>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Controls</h2>
        <div style={styles.row}>
          <button style={buttonStyle(phase !== 'idle', true)} disabled={phase !== 'idle'} onClick={() => void start()}>
            start
          </button>
          <button style={buttonStyle(phase !== 'running')} disabled={phase !== 'running'} onClick={() => void stop()}>
            stop wallet
          </button>
          <button style={buttonStyle(false)} onClick={downloadMemLog}>
            download log
          </button>
          <span style={{ ...styles.badge, background: PHASE_COLORS[phase] }}>{phase}</span>
          <span style={{ ...styles.badge, background: globalThis.crossOriginIsolated ? '#16a34a' : '#d97706' }}>
            {globalThis.crossOriginIsolated ? 'precise heap numbers' : 'heap numbers are quantized!'}
          </span>
        </div>
        {error !== undefined && <div style={styles.error}>{error}</div>}
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Latest sample</h2>
        <StatTiles />
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Memory log</h2>
        <MemLogView />
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<MemoryTest />);
