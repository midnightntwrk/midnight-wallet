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
import net from 'node:net';

/**
 * A bandwidth-capped TCP proxy for sync-throughput measurements: it forwards every byte unmodified but no faster than
 * `bytesPerSecond`, turning the effectively infinite loopback link between test containers into a realistic client link
 * where the wire is the bottleneck — the only regime in which compression can convert byte savings into time savings.
 *
 * The cap is enforced per direction with a cumulative pacing clock: each chunk pushes the direction's `readyAt` forward
 * by the chunk's transfer time at the configured rate, and is delivered when that clock is due. The proxy can therefore
 * never exceed the cap over any interval longer than one chunk, which is what makes lower-bound timing assertions on it
 * deterministic.
 */
export interface ThrottledProxy {
  /** The local port the proxy listens on; point the client here instead of at the target. */
  readonly port: number;
  /** Closes the listener and every open connection. */
  readonly stop: () => Promise<void>;
}

/**
 * Pipes `source` into `dest` at no more than `bytesPerSecond`.
 *
 * Mutation is deliberate and confined to this helper: pacing is inherently stateful (a clock advanced per chunk), and
 * sockets are an inherently mutable external API — `.claude/rules/functional-style.md` permits both for test
 * instrumentation.
 */
const pipeThrottled = (source: net.Socket, dest: net.Socket, bytesPerSecond: number): void => {
  let readyAt = Date.now();

  source.on('data', (chunk: Buffer) => {
    readyAt = Math.max(readyAt, Date.now()) + (chunk.byteLength / bytesPerSecond) * 1_000;
    const delay = readyAt - Date.now();
    if (delay <= 0) {
      dest.write(chunk);
      return;
    }
    // Pause so upstream backpressure applies while the chunk waits for its transfer slot.
    source.pause();
    setTimeout(() => {
      if (!dest.destroyed) dest.write(chunk);
      source.resume();
    }, delay);
  });

  source.on('end', () => {
    const delay = Math.max(0, readyAt - Date.now());
    setTimeout(() => {
      if (!dest.destroyed) dest.end();
    }, delay);
  });

  source.on('error', () => dest.destroy());
};

/**
 * Starts the proxy on an ephemeral port, forwarding to `targetHost:targetPort` with both directions capped at
 * `bytesPerSecond` (pass `Number.POSITIVE_INFINITY` for an uncapped pass-through, useful as a control).
 */
export const startThrottledProxy = (options: {
  readonly targetHost: string;
  readonly targetPort: number;
  readonly bytesPerSecond: number;
}): Promise<ThrottledProxy> => {
  // Mutation confined to this helper: the set of live sockets only exists so `stop` can tear
  // down connections that are mid-transfer.
  const openSockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    const upstream = net.connect(options.targetPort, options.targetHost);
    openSockets.add(client);
    openSockets.add(upstream);
    client.on('close', () => openSockets.delete(client));
    upstream.on('close', () => openSockets.delete(upstream));
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());

    pipeThrottled(client, upstream, options.bytesPerSecond);
    pipeThrottled(upstream, client, options.bytesPerSecond);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Throttled proxy failed to bind an ephemeral port'));
        return;
      }
      resolve({
        port: address.port,
        stop: () =>
          new Promise<void>((resolveStop) => {
            openSockets.forEach((socket) => socket.destroy());
            server.close(() => resolveStop());
          }),
      });
    });
  });
};
