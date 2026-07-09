#!/usr/bin/env node
// One-off migration maintenance: fix stale `latest` dist-tags on the transitional
// @midnight-ntwrk (dashed) alias scope on npmjs.
//
// Some 1.2.0-line versions were mirrored to the dashed scope during a window when
// the alias publish authenticated with the wrong npmjs token, so their `latest`
// tag never advanced (e.g. `@midnight-ntwrk/wallet-sdk` still points at 1.1.0 even
// though 1.2.0 is published). Those versions are immutable, so republishing can't
// fix them — only a `npm dist-tag` move can. OIDC/Trusted Publishing is publish-only
// and cannot move tags, so this runs with a real npmjs token.
//
// For every publishable @midnightntwrk/* package it computes the highest published
// STABLE version of the dashed twin on npmjs and moves `latest` there. Idempotent:
// packages already correct (or absent from npmjs) are skipped.
//
// Reads go straight to npmjs by URL (local dev config maps @midnight-ntwrk to
// GitHub Packages, so we stay explicit). Writes use `npm dist-tag add` with an
// explicit npmjs scope-registry override and need an npmjs token with
// @midnight-ntwrk publish rights, provided as //registry.npmjs.org/:_authToken
// (setup-node writes this from NODE_AUTH_TOKEN).
//
// Usage:
//   node scripts/fix-alias-dist-tags.mjs --dry-run   # show what would change (no auth needed)
//   node scripts/fix-alias-dist-tags.mjs             # apply (needs npmjs auth)

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NPMJS = 'https://registry.npmjs.org';
const SOURCE_SCOPE = '@midnightntwrk/wallet-sdk';
const ALIAS_SCOPE = '@midnight-ntwrk/wallet-sdk';
const toAlias = (s) => s.split(SOURCE_SCOPE).join(ALIAS_SCOPE);
const dryRun = process.argv.includes('--dry-run');

// Compare release (non-prerelease) semvers by numeric major.minor.patch.
const cmpStable = (a, b) => {
  const A = a.split('.').map(Number);
  const B = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
};

// Discover publishable @midnightntwrk/* packages straight from the workspace
// package.json files (no `yarn install` needed in CI).
const aliasNames = readdirSync('packages', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .flatMap((e) => {
    try {
      const pkg = JSON.parse(readFileSync(join('packages', e.name, 'package.json'), 'utf8'));
      if (pkg.private || !pkg.name?.startsWith('@midnightntwrk/')) return [];
      return [toAlias(pkg.name)];
    } catch {
      return [];
    }
  });

const results = [];
for (const name of aliasNames) {
  const res = await fetch(`${NPMJS}/${name.replace('/', '%2f')}`);
  if (!res.ok) {
    results.push({ name, status: 'not-on-npmjs' });
    continue;
  }
  const doc = await res.json();
  const stable = Object.keys(doc.versions ?? {}).filter((v) => !v.includes('-'));
  if (stable.length === 0) {
    results.push({ name, status: 'no-stable' });
    continue;
  }
  const highest = stable.sort(cmpStable).pop();
  const latest = doc['dist-tags']?.latest;
  if (latest === highest) {
    results.push({ name, status: 'ok', latest });
    continue;
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}retag ${name}: latest ${latest} -> ${highest}`);
  if (dryRun) {
    results.push({ name, status: 'would-retag', from: latest, to: highest });
    continue;
  }
  try {
    execFileSync('npm', ['dist-tag', 'add', `${name}@${highest}`, 'latest', `--@midnight-ntwrk:registry=${NPMJS}`], {
      stdio: 'inherit',
    });
    results.push({ name, status: 'retagged', from: latest, to: highest });
  } catch (err) {
    results.push({ name, status: 'failed', from: latest, to: highest, error: err.message });
  }
}

console.log('\n--- Summary ---');
results.forEach((r) => console.log(`  ${r.status.padEnd(12)} ${r.name}${r.from ? ` (${r.from} -> ${r.to})` : ''}`));
if (results.some((r) => r.status === 'failed')) process.exit(1);
