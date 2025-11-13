/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import XRayJsonReporter from './src/reporters/custom-xray-json/xray-json-reporter.js';
import CustomJUnitReporter from './src/reporters/custom-junit/custom-junit-reporter.js';

export default defineConfig({
  test: {
    setupFiles: ['allure-vitest/setup', './setup-env.ts'],
    pool: 'threads',
    environment: 'node',
    testTimeout: 90_000,
    globals: true,
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      enabled: true,
      clean: true,
      include: ['src/**/*.ts'],
      reporter: ['clover', 'json', 'json-summary', 'lcov', 'text'],
      reportsDirectory: './coverage',
    },
    reporters: [
      'default',
      new XRayJsonReporter(), // Add this entry
      new CustomJUnitReporter(),
      [
        'junit',
        {
          outputFile: './reports/junit/test-results.xml',
        },
      ],
      [
        'json',
        {
          outputFile: './reports/json/test-results.json',
        },
      ],
      ['html', { outputFile: './reports/html/index.html' }],
      ['allure-vitest/reporter', { resultsDir: './reports/allure-results' }],
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'undeployed',
          include: ['**/**/tests/*.undeployed.test.ts', '**/**/tests/*.universal.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'remote',
          include: ['**/**/tests/*.remote.test.ts'],
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      // '@': path.resolve(__dirname, './src'),
      // '@infrastructure': path.resolve(__dirname, '../src/infrastructure'),
      // '@e2e': path.resolve(__dirname, '../src/e2e')
    },
  },
});
