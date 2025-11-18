import { packageConfig } from '../../eslint.config.mjs';

const config = packageConfig({
  rules: {
    'no-console': 'off',
  },
});

export default config;
