#!/usr/bin/env node
// Publishes non-private workspace packages to npmjs under TWO scopes during
// the org migration from `@midnight-ntwrk` to `@midnightntwrk`:
//
//   1. Primary — `@midnightntwrk/*` via npm Trusted Publishing (OIDC) +
//      `--provenance`. Published as-is from the workspace, since the source
//      scope is already `@midnightntwrk`. No token: npm authenticates via
//      OIDC against the trusted publisher configured on npmjs.
//
//   2. Alias — `@midnight-ntwrk/*`, transitional, so existing consumers of
//      the dashed scope keep resolving during the migration window. The
//      package is staged in a temp dir with its name, internal SDK deps, and
//      compiled `dist/**` import specifiers rewritten back to the dashed
//      scope, then published with the legacy npm token (NPM_LEGACY_TOKEN).
//      No provenance — token publishes cannot emit OIDC attestations.
//
// The alias publish is skipped (with a warning) when NPM_LEGACY_TOKEN is
// absent, so local runs and the OIDC-only path still work.
//
// Versions already on the registry are skipped so re-runs are idempotent.
//
// Usage:
//   node scripts/publish.mjs              # publish under default dist-tag
//   node scripts/publish.mjs --tag canary # publish under `canary` dist-tag

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const SOURCE_SCOPE = '@midnightntwrk/wallet-sdk';
const ALIAS_SCOPE = '@midnight-ntwrk/wallet-sdk';

const toAlias = (s) => s.split(SOURCE_SCOPE).join(ALIAS_SCOPE);

const { values } = parseArgs({
  options: { tag: { type: 'string' } },
  strict: true,
});

const tagArgs = values.tag ? ['--tag', values.tag] : [];

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

const legacyToken = process.env.NPM_LEGACY_TOKEN;
console.log(`Publishing ${publishable.length} package(s)${values.tag ? ` (dist-tag: ${values.tag})` : ''}:`);
publishable.forEach((ws) => console.log(`  - ${ws.pkg.name}@${ws.pkg.version} (+ alias ${toAlias(ws.pkg.name)})`));
if (!legacyToken) {
  console.log('\n⚠ NPM_LEGACY_TOKEN not set — skipping the @midnight-ntwrk alias publish.');
}

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

// Recursively rewrite the source scope to the dashed alias scope in every
// text file under `dir` that contains it (dist/** is all JS/d.ts/map text).
const rewriteScopeInTree = (dir) => {
  readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteScopeInTree(full);
      return;
    }
    const content = readFileSync(full, 'utf8');
    if (content.includes(SOURCE_SCOPE)) {
      writeFileSync(full, toAlias(content));
    }
  });
};

// Stage a dashed-scope copy of the package in a temp dir and publish it with
// the legacy token. Returns the publish status.
const publishAlias = (ws) => {
  const aliasName = toAlias(ws.pkg.name);
  if (isAlreadyPublished(aliasName, ws.pkg.version)) {
    console.log(`Skip ${aliasName}@${ws.pkg.version}: already published.`);
    return { name: aliasName, version: ws.pkg.version, status: 'skipped' };
  }

  const stage = mkdtempSync(join(tmpdir(), 'publish-alias-'));
  try {
    // Copy everything except node_modules; npm's `files` field decides what
    // actually ships, so extra copied files are harmless.
    cpSync(ws.location, stage, {
      recursive: true,
      filter: (src) => !src.split('/').includes('node_modules'),
    });
    const pkgPath = join(stage, 'package.json');
    writeFileSync(pkgPath, toAlias(readFileSync(pkgPath, 'utf8')));
    rewriteScopeInTree(join(stage, 'dist'));

    console.log(`\nPublishing ${aliasName}@${ws.pkg.version} (alias, token auth)...`);
    execFileSync('npm', ['publish', '--access', 'public', ...tagArgs], {
      cwd: stage,
      stdio: 'inherit',
      env: { ...process.env, NODE_AUTH_TOKEN: legacyToken },
    });
    return { name: aliasName, version: ws.pkg.version, status: 'published' };
  } catch (err) {
    return { name: aliasName, version: ws.pkg.version, status: 'failed', error: err.message };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
};

// Publish the primary @midnightntwrk scope via OIDC + provenance. NODE_AUTH_TOKEN
// is blanked so npm falls back to Trusted Publishing instead of token auth.
const publishPrimary = (ws) => {
  const { name, version } = ws.pkg;
  if (isAlreadyPublished(name, version)) {
    console.log(`\nSkip ${name}@${version}: already published.`);
    return { name, version, status: 'skipped' };
  }

  console.log(`\nPublishing ${name}@${version} (OIDC + provenance)...`);
  try {
    execFileSync('npm', ['publish', '--provenance', '--access', 'public', ...tagArgs], {
      cwd: ws.location,
      stdio: 'inherit',
      env: { ...process.env, NODE_AUTH_TOKEN: '' },
    });
    return { name, version, status: 'published' };
  } catch (err) {
    return { name, version, status: 'failed', error: err.message };
  }
};

const results = publishable.flatMap((ws) => {
  const primary = publishPrimary(ws);
  const alias = legacyToken ? [publishAlias(ws)] : [];
  return [primary, ...alias];
});

const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
console.log('\n--- Publish summary ---');
console.log(`Published: ${counts.published ?? 0}, Skipped: ${counts.skipped ?? 0}, Failed: ${counts.failed ?? 0}`);

const failures = results.filter((r) => r.status === 'failed');
if (failures.length > 0) {
  failures.forEach((f) => console.error(`  ! ${f.name}@${f.version}: ${f.error}`));
  process.exit(1);
}
