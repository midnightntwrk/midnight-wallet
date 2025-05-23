import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { join } from 'node:path';
import del from 'rollup-plugin-delete';
import { dts } from 'rollup-plugin-dts';
import { rimrafSync } from 'rimraf';

/**
 * @typedef Options
 * @type {object}
 * @property {string} [sourceRootFolder] The base folder containing the source files.
 * @property {string} [tsconfig] The filename of the TypeScript configuration file to use.
 * @property {(string|RegExp)[]} [external] Packages or modules listed here will not be included in
 * the compiled bundle.
 * @property {boolean} [shouldClearDist] Whether dist directory should be cleared before build
 */
/** @type {Options} */
const DEFAULT_OPTIONS = {
  sourceRootFolder: 'src',
  distRootFolder: 'dist',
  tsconfig: 'tsconfig.build.json',
  external: [/node_modules/, /@midnight-ntwrk/],
  shouldClearDist: true,
};

/**
 * Builds the Rollup configuration objects for an object representing a `'package.json'` file.
 *
 * @param {string} folderPath The base path of the folder being processed. This will typically be
 * the folder containing the file represented by `packageJson`.
 * @param {PackageJson} packageJson An object representing the `'package.json'` file for which
 * configuration is required.
 * @param {Options} [options] Optional options that will be used while building the configuration
 * options.
 * @returns An array of configuration options that will be processed by 'Rollup.js'.
 */
export default function (folderPath, packageJson, options) {
  options = {
    ...DEFAULT_OPTIONS,
    ...(options ?? []),
    external: [...DEFAULT_OPTIONS.external, ...(options?.external ?? [])],
  };

  //There's no good hook to perform it via delete plugin
  if (options.shouldClearDist) {
    rimrafSync(options.distRootFolder);
  }

  return Object.entries(packageJson.exports).flatMap(([entryName, exports]) => {
    return [
      {
        input: join(options.sourceRootFolder, entryName, 'index.ts'),
        output: [
          {
            file: exports['import'],
            format: 'esm',
            sourcemap: true,
          },
        ],
        cache: false,
        plugins: [
          resolve(),
          typescript({
            tsconfig: options.tsconfig,
            outputToFilesystem: true,
            declaration: true,
            declarationDir: join(options.distRootFolder, entryName, '__typings__'),
          }),
        ],
        external: options.external,
      },
      {
        input: join(options.sourceRootFolder, entryName, 'index.ts'),
        output: [
          {
            file: exports['types'],
            format: 'es',
            sourcemap: true,
          },
        ],
        cache: false,
        plugins: [
          dts({
            tsconfig: options.tsconfig,
            declaration: true,
            declarationDir: join(options.distRootFolder, entryName, '__typings__'),
          }),
          //Can't remove just the specific typings dir for the entry because there's some concurrency
          // and overall timing seems impossible wtihout writing custom plugin
          del({ targets: `${options.distRootFolder}/**/__typings__`, hook: 'writeBundle' }),
        ],
        external: options.external,
      }
    ];
  });
}
