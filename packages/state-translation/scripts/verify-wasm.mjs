// Smoke-check a freshly built translation artifact: does it actually translate?
//
// The build succeeding proves very little. The translation reaches into `midnight-storage`, whose metered loop calls
// `std::time::Instant::now()` — unimplemented on wasm32-unknown-unknown — so an artifact built without the vendored
// clock patch compiles fine and then traps on the first real state. Without this check that surfaces much later, as a
// bare `RuntimeError: unreachable` inside a fork test.
//
// Run from the repository root, after scripts/build-wasm.sh.

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';

import { translateLedgerState } from '../dist/index.js';

const fail = (message) => {
  console.error(`verify-wasm: ${message}`);
  process.exit(1);
};

const preFork = v8.LedgerState.blank('undeployed').serialize();

const translated = await translateLedgerState(preFork).catch((error) => {
  const cause = error?.cause;
  if (cause?.name === 'RuntimeError') {
    fail(
      `the artifact traps when translating (${cause.message}).\n` +
        `  This is what an unpatched midnight-storage looks like: its metered loop calls std::time::Instant::now(),\n` +
        `  which is unimplemented on wasm32-unknown-unknown. See packages/state-translation/wasm/README.md.`,
    );
  }
  fail(`translation failed: ${error?.message ?? error}\n  cause: ${cause?.message ?? '(none)'}`);
});

// Deserializing is the real assertion: it is what says these bytes are a v9 ledger state and not merely some bytes.
const postFork = v9.LedgerState.deserialize(translated);
if (!(postFork instanceof v9.LedgerState)) fail('translation returned bytes that are not a v9 LedgerState');

console.log(`verify-wasm: ok — ${preFork.length} v8 bytes translated to ${translated.length} v9 bytes`);
