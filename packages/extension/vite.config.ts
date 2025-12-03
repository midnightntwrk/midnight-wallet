import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'path';
import { rename, mkdir, copyFile } from 'fs/promises';
import { build } from 'vite';

function moveHtmlPlugin(): Plugin {
  return {
    name: 'move-html',
    closeBundle: async () => {
      try {
        await mkdir(resolve(__dirname, 'dist/popup'), { recursive: true });
        await rename(
          resolve(__dirname, 'dist/src/popup/index.html'),
          resolve(__dirname, 'dist/popup/index.html')
        );
      } catch {}
    },
  };
}

function buildInjectedPlugin(): Plugin {
  return {
    name: 'build-injected',
    closeBundle: async () => {
      try {
        await mkdir(resolve(__dirname, 'dist/injected'), { recursive: true });

        await build({
          configFile: false,
          build: {
            outDir: resolve(__dirname, 'dist/injected'),
            emptyOutDir: false,
            lib: {
              entry: resolve(__dirname, 'src/injected/provider.ts'),
              formats: ['iife'],
              name: 'MidnightProvider',
              fileName: () => 'provider.js',
            },
            rollupOptions: {
              output: {
                inlineDynamicImports: true,
              },
            },
            minify: 'esbuild',
            sourcemap: false,
          },
          resolve: {
            alias: {
              '@': resolve(__dirname, 'src'),
            },
          },
        });
      } catch (err) {
        console.error('Failed to build injected script:', err);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream'],
      globals: { Buffer: true, process: true },
    }),
    wasm(),
    topLevelAwait(),
    react(),
    moveHtmlPlugin(),
    buildInjectedPlugin(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background/index.js';
          if (chunkInfo.name === 'content') return 'content/index.js';
          return '[name]/[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  publicDir: 'public',
});
