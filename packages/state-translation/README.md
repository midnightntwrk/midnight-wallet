# @midnightntwrk/wallet-sdk-state-translation

Wallet-side access to the ledger's **v8-to-v9 ledger state translation**: serialized pre-fork ledger state in,
serialized post-fork ledger state out.

```typescript
import { translateLedgerState } from '@midnightntwrk/wallet-sdk-state-translation';
import * as v9 from '@midnightntwrk/ledger-v9';

const postFork = v9.LedgerState.deserialize(await translateLedgerState(preForkLedger.serialize()));
```

**This package is private and test-only.** No wallet runtime path translates ledger state — a resync with the post-fork
ledger is the wallet's migration mechanism. What this exists for is testing a fork faithfully: a
`ForkHandover.TranslateLedger` in `@midnightntwrk/wallet-sdk-capabilities` can carry the pre-fork chain's own state
across the boundary instead of approximating it by re-minting.

## Layout

```
src/          this loader: resolve the WASM module, check it, hand it bytes
wasm/         the wasm-bindgen crate that produces the module (see wasm/README.md)
wasm/pkg/     its build output — gitignored, and where the loader looks by default
scripts/      build-wasm.sh
```

The translation itself is Rust and stays in the ledger repository as an ordinary crate. It links **both** ledgers at
once — `ledger-v8` and `ledger-v9`, plus two distinct majors of `onchain-state` — which is something no JavaScript
module can do, and the reason the seam that consumes this (`LedgerStateTranslator` in `capabilities`) is stated in
serialized bytes rather than state objects.

The **bindings** live here rather than in the ledger repository, because needing the translation from JavaScript is a
wallet concern. `wasm/Cargo.toml` depends on the translation crate the ordinary way — pinned to a git branch only until
it reaches crates.io.

Keeping all of this out of `capabilities` keeps a WASM blob out of a published package's dependency graph;
`capabilities` depends on this only as a `devDependency`.

## Building the translation

```bash
yarn workspace @midnightntwrk/wallet-sdk-state-translation build:wasm
```

That is the whole local flow — no environment variable. Output lands in `wasm/pkg/`, which is the loader's default, so
anything that needs the translation just works afterwards. Roughly 1.7 MB of wasm after `wasm-opt`.

It needs a Rust toolchain and, on macOS, Homebrew's LLVM; the script checks for each and says what is missing. See
[`wasm/README.md`](./wasm/README.md) for the toolchain, and for the one prerequisite the script cannot check —
`midnight-storage` needs a wasm-safe `Instant`, without which the translation compiles but traps at runtime.

`MIDNIGHT_V8_TO_V9_STATE_TRANSLATION` overrides the default with a module specifier, for an artifact built somewhere
else.

`isLedgerStateTranslationAvailable()` reports whether either is in place, which is how tests needing the translation
decide to skip. They live in `packages/capabilities/src/simulation/test/forkStateTranslation.integration.test.ts` —
integration tier precisely because of the build step above.

## Errors

| Error                              | Means                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `StateTranslationUnavailableError` | The module could not be loaded, or exposes no translation. Nothing was attempted.    |
| `StateTranslationFailedError`      | The translation ran and did not produce bytes. Its own error is kept as the `cause`. |

Whether the returned bytes are a _valid_ post-fork state is decided by whoever deserializes them — in the fork harness,
that surfaces as a `LedgerTranslationError`.
