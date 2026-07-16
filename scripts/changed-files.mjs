#!/usr/bin/env node
// Print files changed vs HEAD — tracked modifications plus untracked files — one per line.
// Generic building block: pipe into whatever needs a changed-file list, e.g.
//   node scripts/changed-files.mjs | xargs -r yarn format:file
//
// Why not `turbo run format --affected`? Three mismatches:
//   1. Granularity: --affected selects whole *packages* and runs their format script
//      (prettier over the entire package), rewriting files you never touched.
//      This script feeds prettier only the changed files.
//   2. Root coverage: --affected only sees workspace packages. Root-level files
//      (CLAUDE.md, scripts/, docs/) have no package format task — format:file with
//      .prettierignore.root is the only thing that formats them.
//   3. Diff base: --affected diffs against the merge-base with main (the whole
//      branch); this diffs against HEAD (your current uncommitted work), which is
//      the right semantics for "format what I'm about to commit".
// `--affected` IS the right fit for package-level tasks — see lint:changed.
import { execFileSync } from 'node:child_process';

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

const files = [
  ...git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
  ...git(['ls-files', '--others', '--exclude-standard']),
];

if (files.length > 0) {
  process.stdout.write(files.join('\n') + '\n');
}
