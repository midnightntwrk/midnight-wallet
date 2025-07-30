import rootConfig from '../../eslint.config.mjs';

export default [
  {
    ignores: ['*.mjs', 'dist/**', 'coverage'],
  },
  ...rootConfig.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'test/**/*.ts'],
  })),
];
