// Reconciles the provisional `facade-unreleased` train to the real version, at release time.
//
// Wired into the root `changeset:version` script, which the changesets action runs to build the
// "Version Packages" PR. By then `changeset version` has bumped packages/facade/package.json to the
// version this release will publish, so we rename fixtures/facade-unreleased -> fixtures/facade-<that
// version> and stamp the `train`/`version` fields. Running inside the version step (not a manual
// commit) means the change lands in the same PR the bot force-pushes, instead of being clobbered.
//
// No-op when there is no unreleased capture (most releases don't change a persisted format).
import { readdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');
const unreleasedDir = path.join(FIXTURES, 'facade-unreleased');

if (!existsSync(unreleasedDir)) {
  console.log('reconcile-train: no facade-unreleased train; nothing to do');
  process.exit(0);
}

const facadeVersion = JSON.parse(readFileSync(path.join(HERE, '..', 'facade', 'package.json'), 'utf8')).version;
const train = `facade-${facadeVersion}`;
const targetDir = path.join(FIXTURES, train);
if (existsSync(targetDir)) {
  throw new Error(`reconcile-train: ${train} already exists — facade was not bumped, or this train was already frozen`);
}

for (const file of readdirSync(unreleasedDir)) {
  const filePath = path.join(unreleasedDir, file);
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  delete data.capturedFrom;
  writeFileSync(filePath, JSON.stringify({ ...data, train, version: facadeVersion }, null, 2) + '\n');
}
renameSync(unreleasedDir, targetDir);
console.log(`reconcile-train: froze facade-unreleased as ${train}`);
