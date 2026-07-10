// Throwaway config to run the manually-excluded fundTestWallets.remote.test.ts directly.
/// <reference types="vitest" />
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/tests/fundTestWallets.remote.test.ts'],
    exclude: [...configDefaults.exclude, '**/dist/**'],
    setupFiles: ['../../setup-env.ts', './src/tests/setup-retry-logging.ts'],
    environment: 'node',
    hookTimeout: 3_600_000,
    testTimeout: 3_600_000,
    globals: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
});
