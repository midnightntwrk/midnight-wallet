#!/usr/bin/env node
// Publishes non-private workspace packages to npmjs via the npm CLI.
//
// Uses npm's native Trusted Publishing flow when running in CI with
// `id-token: write` granted and a matching trusted publisher configured
// on npmjs (no NODE_AUTH_TOKEN required). Emits provenance attestations
// via `--provenance`.
//
// Versions already on the registry are skipped so re-runs are idempotent.
//
// Usage:
//   node scripts/publish.mjs              # publish under default dist-tag
//   node scripts/publish.mjs --tag canary # publish under `canary` dist-tag

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { tag: { type: 'string' } },
  strict: true,
});

const workspaces = execFileSync('yarn', ['workspaces', 'list', '--json'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .filter((ws) => ws.location !== '.');

const publishable = workspaces.flatMap((ws) => {
  const pkg = JSON.parse(readFileSync(resolve(ws.location, 'package.json'), 'utf8'));
  return pkg.private ? [] : [{ ...ws, pkg }];
});

if (publishable.length === 0) {
  console.log('No publishable packages found.');
  process.exit(0);
}

console.log(`Publishing ${publishable.length} package(s)${values.tag ? ` (dist-tag: ${values.tag})` : ''}:`);
publishable.forEach((ws) => console.log(`  - ${ws.pkg.name}@${ws.pkg.version}`));

const isAlreadyPublished = (name, version) => {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const versions = JSON.parse(out);
    return Array.isArray(versions) ? versions.includes(version) : versions === version;
  } catch {
    // Package not on the registry yet — first publish.
    return false;
  }
};

const results = publishable.map((ws) => {
  const { name, version } = ws.pkg;

  if (isAlreadyPublished(name, version)) {
    console.log(`\nSkip ${name}@${version}: already published.`);
    return { name, version, status: 'skipped' };
  }

  const args = ['publish', '--provenance', '--access', 'public'];
  if (values.tag) args.push('--tag', values.tag);

  console.log(`\nPublishing ${name}@${version}...`);
  try {
    execFileSync('npm', args, { cwd: ws.location, stdio: 'inherit' });
    return { name, version, status: 'published' };
  } catch (err) {
    return { name, version, status: 'failed', error: err.message };
  }
});

const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
console.log('\n--- Publish summary ---');
console.log(`Published: ${counts.published ?? 0}, Skipped: ${counts.skipped ?? 0}, Failed: ${counts.failed ?? 0}`);

const failures = results.filter((r) => r.status === 'failed');
if (failures.length > 0) {
  failures.forEach((f) => console.error(`  ! ${f.name}@${f.version}: ${f.error}`));
  process.exit(1);
}
