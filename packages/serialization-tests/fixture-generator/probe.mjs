// Dev-time helper: dump the API surface of each historical train so generate.mjs
// can be written against facts instead of guesses. Not needed after fixtures exist.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const pkgDir = (alias) => path.join(HERE, 'node_modules', alias);

// Resolve a dependency exactly as the aliased package itself would (nested vs hoisted node_modules).
export const resolveFromPkg = (alias, dep) =>
  createRequire(path.join(pkgDir(alias), 'dist', 'index.js')).resolve(dep);

const surface = async (alias, files) => {
  console.log(`\n===== ${alias}`);
  const pkgJson = JSON.parse(readFileSync(path.join(pkgDir(alias), 'package.json'), 'utf8'));
  const ledgerDep = Object.keys(pkgJson.dependencies ?? {}).find((d) => d.includes('ledger'));
  console.log(`  version: ${pkgJson.version}  ledger: ${ledgerDep}@${pkgJson.dependencies[ledgerDep]}`);
  for (const f of files) {
    const p = path.join(pkgDir(alias), 'dist', f);
    if (!existsSync(p)) {
      console.log(`  ${f}: (absent)`);
      continue;
    }
    try {
      const mod = await import(pathToFileURL(p));
      const names = Object.keys(mod);
      console.log(`  ${f}: ${names.join(', ')}`);
      for (const n of names) {
        const v = mod[n];
        if (typeof v === 'function' && /CoreWallet|State|Storage/.test(n)) {
          const statics = Object.getOwnPropertyNames(v).filter(
            (p2) => typeof v[p2] === 'function' && !['bind', 'call', 'apply'].includes(p2),
          );
          if (statics.length > 0) console.log(`    ${n} statics: ${statics.join(', ')}`);
        }
      }
    } catch (e) {
      console.log(`  ${f}: FAILED TO IMPORT (${String(e.message).slice(0, 120)})`);
    }
  }
};

const wallets = process.argv[2] ? [process.argv[2]] : ['sh', 'un', 'du'];
const trains = process.argv[3] ? [process.argv[3]] : ['t1', 't2', 't3', 't4', 't6'];
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const w of wallets) {
    for (const t of trains) {
      await surface(`${w}-${t}`, ['v1/Serialization.js', 'v1/CoreWallet.js', 'v1/UnshieldedState.js', 'v1/Keys.js']);
    }
  }
}
