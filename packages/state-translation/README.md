# @midnightntwrk/wallet-sdk-state-translation

Wallet-side access to the ledger's **v8-to-v9 ledger state translation**: serialized ledger-v8 state in, serialized
ledger-v9 state out.

```typescript
import { translateLedgerState } from '@midnightntwrk/wallet-sdk-state-translation';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';

// `v8State` is a ledger-v8 `LedgerState`
const v9State = ledgerV9.LedgerState.deserialize(await translateLedgerState(v8State.serialize()));
```

**This package is private and test-only.** No wallet runtime path translates ledger state — a resync with ledger-v9 is
the wallet's migration mechanism. What this exists for is testing a fork faithfully: a `ForkSimulator` in
`@midnightntwrk/wallet-sdk-capabilities` can carry the ledger-v8 chain's own state across the boundary instead of
approximating it.

## Layout

```
src/          the adapter: hand the WASM bytes, hand bytes back
wasm/         the wasm-bindgen crate that produces the module (see wasm/README.md)
wasm/pkg/     its build output — gitignored, apart from the committed .d.ts
scripts/      build-wasm.sh, verify-wasm.mjs
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

Output lands in `wasm/pkg/`, which `src/` imports directly. Roughly 1.7 MB of wasm after `wasm-opt`.

You rarely need to run it by hand: `turbo` builds it before any `test:integration` in this package or in
`@midnightntwrk/wallet-sdk-capabilities`, which declare a dependency on the `artifacts` task. That is also why running
those integration tests needs a Rust toolchain, while `dist`, `typecheck`, `lint` and `test:unit` do not — the `.d.ts`
the import types against is committed.

`artifacts` is this package's one public build task: a command-less gate meaning _the WASM exists and is known to
translate_, which is `build:wasm` followed by the `verify:wasm` below. Anything outside this package depends on that
gate rather than on `build:wasm`, so the toolchain, the `wasm-bindgen` pin and the vendored storage patch stay ours to
change.

It needs a Rust toolchain and, on macOS, Homebrew's LLVM; the script checks for each and says what is missing. See
[`wasm/README.md`](./wasm/README.md) for the toolchain and for the vendored `midnight-storage` patch the script applies
on the way through.

```bash
yarn workspace @midnightntwrk/wallet-sdk-state-translation verify:wasm
```

confirms a built artifact actually translates. Worth running after any change to the crate: compiling proves less than
it looks like, since an artifact built against an unpatched `midnight-storage` links fine and then traps on the first
real state.

CI builds and verifies the artifact in the `Build WASM Translation` job, and the integration matrix reuses that build
through the turbo cache.

The import is static and there is no fallback: this package and the crate it wraps are the same unit, so a missing
artifact is a broken build rather than a state worth modelling. Tests that exercise the real translation live in
`src/test/stateTranslation.integration.test.ts` here (the adapter) and
`packages/capabilities/src/simulation/test/forkStateTranslation.integration.test.ts` (the fork).

## Errors

| Error                         | Means                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `StateTranslationFailedError` | The translation ran and did not produce bytes. Its own error is kept as the `cause`. |

Whether the returned bytes are a _valid_ ledger-v9 state is decided by whoever deserializes them — in the fork harness,
that surfaces as a `LedgerTranslationError`.
