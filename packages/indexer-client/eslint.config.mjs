import rootConfig from "../../eslint.config.mjs";

export default [
  {
    ignores: [
      '*.mjs',
      'dist/',
      '.rollup.cache/',
      'src/graphql/generated'
    ]
  },
  ...rootConfig.map(config => ({
    ...config,
    files: [
      'src/**/*.ts',
      'test/**/*.ts'
    ]
  })),
];
