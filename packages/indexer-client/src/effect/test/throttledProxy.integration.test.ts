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
import { describe, expect, it } from 'vitest';
import { startThrottledProxy, type ThrottledProxy } from './throttledProxy.js';

// The sync-throughput measurements stand on this proxy: if its cap leaked, "deflate drains
// faster" could be an artifact of the harness. These tests pin the two properties the
// measurements rely on — bytes pass unmodified, and the cap is a hard floor on transfer time.
// Loopback sockets only; no Docker or external services.

/** A loopback server that echoes everything back, reporting its own port. */
const startEchoServer = (): Promise<{ readonly port: number; readonly stop: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.pipe(socket));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Echo server failed to bind an ephemeral port'));
        return;
      }
      resolve({
        port: address.port,
        stop: () => new Promise<void>((resolveStop) => server.close(() => resolveStop())),
      });
    });
  });

/** Sends `payload` through `port`, resolving with everything echoed back once the socket ends. */
const roundTrip = (port: number, payload: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    // Mutation confined to test setup: chunks arrive over time; there is nothing to fold over.
    const received: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      received.push(chunk);
      if (received.reduce((sum, c) => sum + c.byteLength, 0) >= payload.byteLength) {
        socket.end();
        resolve(Buffer.concat(received));
      }
    });
    socket.on('error', reject);
    socket.write(payload);
  });

describe('throttledProxy', () => {
  it('delivers bytes unmodified when uncapped', async () => {
    const echo = await startEchoServer();
    const proxy: ThrottledProxy = await startThrottledProxy({
      targetHost: '127.0.0.1',
      targetPort: echo.port,
      bytesPerSecond: Number.POSITIVE_INFINITY,
    });
    try {
      const payload = Buffer.from(Array.from({ length: 64 * 1024 }, (_, i) => i % 251));

      const echoed = await roundTrip(proxy.port, payload);

      expect(echoed.equals(payload)).toBe(true);
    } finally {
      await proxy.stop();
      await echo.stop();
    }
  });

  it('enforces the bandwidth cap as a hard floor on transfer time', async () => {
    const echo = await startEchoServer();
    // 128 KiB each way at 256 KiB/s: >= 0.5 s per direction by construction.
    const proxy = await startThrottledProxy({
      targetHost: '127.0.0.1',
      targetPort: echo.port,
      bytesPerSecond: 256 * 1024,
    });
    try {
      const payload = Buffer.from(Array.from({ length: 128 * 1024 }, (_, i) => i % 251));

      const startedAt = performance.now();
      const echoed = await roundTrip(proxy.port, payload);
      const elapsedMs = performance.now() - startedAt;

      expect(echoed.equals(payload)).toBe(true);
      // The provable floor: the last echoed byte cannot arrive before the whole payload has
      // crossed the upstream direction, which alone takes >= 500 ms at this cap. The two
      // directions overlap (the echo pipelines), so their floors do NOT add. Only the lower
      // bound is asserted — the cap makes "too fast" impossible, while "how slow" depends on
      // machine load and would flake.
      expect(elapsedMs).toBeGreaterThanOrEqual(500);
    } finally {
      await proxy.stop();
      await echo.stop();
    }
  });
});
