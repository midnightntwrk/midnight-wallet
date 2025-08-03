import {packageConfig} from '../../eslint.config.mjs';

export default [
  ...packageConfig(),
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-misused-promises': 'off', // https://github.com/typescript-eslint/typescript-eslint/issues/5807
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      'no-console': 'off', // E2E tests will require writing to the console.
      'brace-style': [ 'error', '1tbs' ],
    }
  }
];
