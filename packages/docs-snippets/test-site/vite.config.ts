import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  root: new URL('./', import.meta.url).pathname,
  build: {
    outDir: 'dist',
  },
  // @ts-expect-error - vite-plugin-wasm is not typed
  plugins: [wasm(), nodePolyfills({ include: ['buffer', 'assert'], globals: { Buffer: true }, protocolImports: true })],
});
