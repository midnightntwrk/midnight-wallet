import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { rename, mkdir } from 'fs/promises';

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

export default defineConfig({
  plugins: [react(), moveHtmlPlugin()],
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
