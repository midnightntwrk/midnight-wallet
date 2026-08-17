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

import { defineConfig, type Connect, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { type ServerResponse } from 'node:http';

// Cross-origin isolation makes Chrome report precise (non-quantized)
// performance.memory numbers. Scoped to the memory test page only, so the
// other pages keep default (non-isolated) behavior. COOP/COEP are
// document-level headers, so they only need to be set on the HTML response.
const ISOLATED_PAGES = ['/memory', '/memory.html'];

const isolationMiddleware: Connect.NextHandleFunction = (req, res: ServerResponse, next) => {
  const path = req.url?.split('?')[0] ?? '';
  if (ISOLATED_PAGES.includes(path)) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  next();
};

const crossOriginIsolateMemoryPage = (): Plugin => ({
  name: 'cross-origin-isolate-memory-page',
  configureServer: (server) => {
    server.middlewares.use(isolationMiddleware);
  },
  configurePreviewServer: (server) => {
    server.middlewares.use(isolationMiddleware);
  },
});

export default defineConfig({
  root: new URL('./', import.meta.url).pathname,
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        memory: new URL('./memory.html', import.meta.url).pathname,
      },
    },
  },
  plugins: [
    // @ts-expect-error - vite-plugin-wasm is not typed
    wasm(),
    nodePolyfills({ include: ['buffer', 'assert'], globals: { Buffer: true }, protocolImports: true }),
    crossOriginIsolateMemoryPage(),
  ],
});
