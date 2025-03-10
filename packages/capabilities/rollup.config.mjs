import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import configure from '../../rollup.config.mjs';
import packageJson from './package.json' with { type: 'json' };
import { dts } from 'rollup-plugin-dts';
import del from 'rollup-plugin-delete';

const configuration = configure(dirname(fileURLToPath(import.meta.url)), packageJson);

export default [
  ...configuration,
  {
    input: 'dist/index.d.ts',
    output: [{ file: 'dist/index.d.ts', format: 'es' }],
    plugins: [
      dts(),
      del({
        targets: ['dist/balancer'],
        hook: 'buildEnd',
      }),
    ],
  },
];
