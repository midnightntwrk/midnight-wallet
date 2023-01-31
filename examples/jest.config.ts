import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  verbose: true,
  roots: ['<rootDir>'],
  modulePaths: ['<rootDir>'],
  testPathIgnorePatterns: ['node_modules', 'dist'],
  passWithNoTests: true,
  testMatch: ['**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  testTimeout: 30000,
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        useESM: true
      }
    ]
  }
};

export default config;
