/// <reference types="vitest" />
/// <reference types="vitest/globals" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      enabled: true,
      clean: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/test/**', '**/*.test.ts', '**/*.test.tsx'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
    },
    reporters: [
      'default',
      ['junit', { outputFile: 'reports/test-report.xml' }],
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
