#!/usr/bin/env node
// Claude Code Stop hook: make Claude verify its work before ending its turn.
// Runs `yarn verify:changed` (format + typecheck + lint + Effect diagnostics of changed packages).
// On failure, exit 2 blocks the stop and feeds the errors back to Claude to fix.
// stop_hook_active guards against blocking in an endless loop: if a previous
// block already resumed the turn and it still fails, let the stop through so
// the user sees the remaining errors instead of Claude spinning forever.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = (() => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
})();

if (input.stop_hook_active) process.exit(0);

try {
  execFileSync('yarn', ['verify:changed'], { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  process.stderr.write(String(e.stdout ?? ''));
  process.stderr.write(String(e.stderr ?? ''));
  process.stderr.write('\nyarn verify:changed failed — fix the errors above before ending the turn.\n');
  process.exit(2);
}
