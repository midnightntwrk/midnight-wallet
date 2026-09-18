#!/usr/bin/env node
// Run @effect/language-service diagnostics on changed packages/**/*.ts(x) files.
// Uses the plugin config from tsconfig.base.json, with `deterministicKeys` downgraded
// to "off": main has pre-existing violations whose fix renames runtime `_tag` strings
// (a breaking API change) — cleanup tracked in issue #577. Remove the override once it lands.
import { execFileSync, spawnSync } from 'node:child_process';
import ts from 'typescript';

const changed = execFileSync('node', ['scripts/changed-files.mjs'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /^packages\/.*\.tsx?$/.test(file));

if (changed.length === 0) process.exit(0);

// Parse with TypeScript's own tsconfig reader (JSONC-aware: comments, trailing commas) —
// the same parser tsc uses, so it can never disagree with how the config is interpreted.
const { config: baseConfig, error } = ts.readConfigFile('tsconfig.base.json', ts.sys.readFile);
if (error) {
  console.error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  process.exit(1);
}
const plugin = baseConfig.compilerOptions.plugins.find((p) => p.name === '@effect/language-service');
const lspConfig = {
  ...plugin,
  diagnosticSeverity: { ...plugin.diagnosticSeverity, deterministicKeys: 'off' },
};

const failures = changed.filter((file) => {
  const result = spawnSync(
    'yarn',
    [
      'effect-language-service',
      'diagnostics',
      '--file',
      `${process.cwd()}/${file}`,
      '--format',
      'pretty',
      '--lspconfig',
      JSON.stringify(lspConfig),
    ],
    { stdio: 'inherit' },
  );
  return result.status !== 0;
});

process.exit(failures.length > 0 ? 1 : 0);
