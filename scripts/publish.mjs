#!/usr/bin/env node
// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Publishes non-private workspace packages to npmjs under TWO scopes during the
// org migration from `@midnight-ntwrk` to `@midnightntwrk`, both via npm Trusted
// Publishing (OIDC) + `--provenance` (no tokens):
//
//   1. Primary `@midnightntwrk/*` — published as-is from the workspace.
//   2. Alias `@midnight-ntwrk/*` — transitional, so dashed-scope consumers keep
//      resolving; staged in a temp dir with the scope rewritten, then published.
//
// Versions already on the registry are skipped so re-runs are idempotent.
//
// Usage:
//   node scripts/publish.mjs              # dist-tag from changesets pre mode, else `latest`
//   node scripts/publish.mjs --tag canary # force the `canary` dist-tag

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const SOURCE_SCOPE = '@midnightntwrk/wallet-sdk';
const ALIAS_SCOPE = '@midnight-ntwrk/wallet-sdk';

const toAlias = (s) => s.split(SOURCE_SCOPE).join(ALIAS_SCOPE);

// Migration banner prepended to the alias (dashed) package README so the
// notice is visible on npmjs. `primaryName` is the @midnightntwrk target.
const migrationBanner = (primaryName) =>
  [
    '> [!IMPORTANT]',
    `> **This package has moved.** The \`@midnight-ntwrk\` scope is published only`,
    `> during the migration window and will stop receiving updates. Please migrate to`,
    `> [\`${primaryName}\`](https://www.npmjs.com/package/${primaryName}).`,
    '',
    '---',
    '',
    '',
  ].join('\n');

const { values } = parseArgs({
  options: { tag: { type: 'string' } },
  strict: true,
});

// Resolve the dist-tag once: an explicit --tag wins (the canary flow passes
// --tag canary), otherwise honor changesets pre mode (.changeset/pre.json with
// `mode: "pre"` → its tag, e.g. beta), otherwise undefined so npm publishes
// under `latest`. Reading pre.json directly mirrors scripts/write-canary-changeset.mjs
// and cd.yml's grep on the same file.
const readPreState = () => {
  try {
    return JSON.parse(readFileSync('.changeset/pre.json', 'utf8'));
  } catch {
    return undefined; // No .changeset/pre.json (or unreadable) → not in pre mode.
  }
};

// Precedence: an explicit --tag wins (the canary flow passes --tag canary),
// otherwise the changesets pre tag (e.g. beta), otherwise undefined → `latest`.
const resolveDistTag = (explicitTag, preState) => {
  if (explicitTag) return explicitTag;
  if (preState?.mode === 'pre' && typeof preState.tag === 'string' && preState.tag.length > 0) {
    return preState.tag;
  }
  return undefined;
};

const distTag = resolveDistTag(values.tag, readPreState());
const tagArgs = distTag ? ['--tag', distTag] : [];

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

console.log(`Publishing ${publishable.length} package(s)${distTag ? ` (dist-tag: ${distTag})` : ''}:`);
publishable.forEach((ws) => console.log(`  - ${ws.pkg.name}@${ws.pkg.version} (+ alias ${toAlias(ws.pkg.name)})`));

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

// Stage a dashed-scope copy of the package in a temp dir and publish it via
// OIDC + provenance. Returns the publish status.
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

    // Rewrite the README body to the dashed scope (so examples match the
    // installed package) and prepend a migration banner pointing at the
    // @midnightntwrk target. npm ships README.md even when `files` omits it.
    const readmePath = join(stage, 'README.md');
    const readmeBody = existsSync(readmePath) ? toAlias(readFileSync(readmePath, 'utf8')) : '';
    writeFileSync(readmePath, migrationBanner(ws.pkg.name) + readmeBody);

    console.log(`\nPublishing ${aliasName}@${ws.pkg.version} (alias, OIDC + provenance)...`);
    execFileSync('npm', ['publish', '--provenance', '--access', 'public', ...tagArgs], {
      cwd: stage,
      stdio: 'inherit',
    });
    return { name: aliasName, version: ws.pkg.version, status: 'published' };
  } catch (err) {
    return { name: aliasName, version: ws.pkg.version, status: 'failed', error: err.message };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
};

// Publish the primary @midnightntwrk scope via OIDC + provenance.
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
    });
    return { name, version, status: 'published' };
  } catch (err) {
    return { name, version, status: 'failed', error: err.message };
  }
};

const results = publishable.flatMap((ws) => {
  // Under any non-`latest` dist-tag (a canary snapshot or a changesets pre/beta
  // release), only publish prerelease-versioned packages. A prerelease version
  // always carries a semver "-"; a canonical version (no "-") must never sit
  // under a prerelease dist-tag. Plain `latest` releases resolve no dist-tag
  // (distTag undefined), so this never affects them.
  if (distTag && !ws.pkg.version.includes('-')) {
    console.log(`Skip ${ws.pkg.name}@${ws.pkg.version}: not a prerelease version for --tag ${distTag}.`);
    return [];
  }
  const primary = publishPrimary(ws);
  // Only mirror to the dashed alias once the primary scope is in good shape
  // (published or already present). If the primary publish failed, skip the
  // alias so the transitional scope never leads the @midnightntwrk one.
  if (primary.status === 'failed') {
    const aliasName = toAlias(ws.pkg.name);
    console.error(`Skip alias ${aliasName}@${ws.pkg.version}: primary publish failed.`);
    return [primary];
  }
  return [primary, publishAlias(ws)];
});

const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
console.log('\n--- Publish summary ---');
console.log(`Published: ${counts.published ?? 0}, Skipped: ${counts.skipped ?? 0}, Failed: ${counts.failed ?? 0}`);

const failures = results.filter((r) => r.status === 'failed');
if (failures.length > 0) {
  failures.forEach((f) => console.error(`  ! ${f.name}@${f.version}: ${f.error}`));
  process.exit(1);
}
