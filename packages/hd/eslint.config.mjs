import rootConfig from '../../eslint.config.mjs';

export default [
  {
    ignores: ['*.mjs', 'coverage'],
  },
  ...rootConfig.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'test/**/*.ts'],
  })),
];
