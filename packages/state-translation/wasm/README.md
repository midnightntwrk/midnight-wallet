# v8-to-v9-state-translation-wasm

WASM bindings for the ledger's v8-to-v9 ledger state translation. One export:

```typescript
export function translate_ledger_state(v8_bytes: Uint8Array): Uint8Array;
```

Built by `../scripts/build-wasm.sh` into `pkg/`, which is where the parent package's loader looks by default. This is a
standalone Cargo project — the wallet SDK has no Rust workspace, and nothing here is published.

## Why the bindings live here and not in `midnight-ledger`

The translation itself is a normal Rust crate (`v8-to-v9-state-translation`) and stays in the ledger repository. The
_bindings_ are a wallet concern: the wallet is what needs the translation reachable from JavaScript, so it owns the
`wasm-bindgen` wrapper and the packaging. That keeps the ledger repository free of a wasm target it has no use for, and
means changing the binding does not need a PR against someone else's release branch.

The dependency is therefore an ordinary crate dependency. It is pinned to a git branch only because the crate is not
released yet:

```toml
v8-to-v9-state-translation = { git = "...", branch = "tkerber/state-translation/v8-to-v9" }
```

Once it reaches crates.io that becomes `version = "0.1.0"` and nothing else changes.

Note the `[patch.crates-io]` block: the ledger's v9 line is in pre-release and not on crates.io, its own workspace
redirects those crates to git tags, and Cargo only honours `[patch]` from the top-level manifest. Consuming the
translation from outside that workspace means replicating the block, which is what the standalone
`v8-to-v9-state-translation-replay` crate does too. **It has to be kept in step when those tags move.**

## Iterating against a local checkout

Cargo's `paths` override swaps in a local copy without touching `Cargo.toml`. Create a gitignored `.cargo/config.toml`
here:

```toml
paths = ["/path/to/midnight-ledger/v8-to-v9-state-translation"]
```

## Prerequisite: `midnight-storage` needs a wasm-safe clock

**This crate compiles today but traps at runtime with an unpatched `midnight-storage`**, and the fix is not in this
crate.

`storage/src/state_translation.rs` imports `std::time::Instant` and calls `Instant::now()` at eight sites in the metered
loop, including inside `run()`. That intrinsic is unimplemented on `wasm32-unknown-unknown` and traps, so the first
`run()` takes the translation down as `RuntimeError: unreachable`. Verified in isolation: a wasm export whose whole body
is `Instant::now()` traps identically.

The fix is a drop-in, cfg-gated to wasm only, leaving every other target byte-identical:

```rust
// storage/src/state_translation.rs
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
use web_time::Instant;
```

```toml
# storage/Cargo.toml
[target.'cfg(all(target_arch = "wasm32", target_os = "unknown"))'.dependencies]
web-time = "^1.1.0"
```

`web-time` re-exports `std::time` on non-wasm targets and backs `Instant` with `performance.now()` on wasm.

**It has to be published, not just committed** — this crate takes `midnight-storage` from crates.io, and redirecting it
to a local checkout does not work: the git-tagged v9 crates fail against the ledger workspace's copy with 151
trait-mismatch errors in `midnight-onchain-state`, that copy having drifted past the released one.

Until a release carries the fix, use a `paths` override in the gitignored `.cargo/config.toml` above, pointing at a
patched copy of whichever published version `Cargo.lock` resolves — `paths` requires an exact name _and_ version match,
so re-copy it after any resolution change. Note this crate currently resolves **2.0.2**, which is newer than the 2.0.1
the ledger workspace pins, and 2.0.2 does not contain the fix either.

## Two things worth knowing before editing `src/lib.rs`

1. **Serialize inside the translation's lifetime.** Returning the v9 state and serializing after the
   `TypedTranslationState` drops panics with
   `storage-core/src/arena.rs: "Arena should contain current serialization target"` — the translated nodes live in the
   arena the translation owns. With `panic = "abort"` the first panic also leaves an arena `RefCell` borrowed, so every
   later call fails with a misleading `RefCell already borrowed`; chase the first panic, not the repeat.
2. **The panic hook is load-bearing.** The `wasm` profile aborts on panic, so without `console_error_panic_hook` every
   failure reaches JavaScript as a bare `RuntimeError: unreachable`. Both bugs above were undiagnosable until it was
   added.

## Toolchain

```bash
brew install rustup binaryen llvm
rustup default stable && rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.104 --locked
```

- `rustup`, not brew's `rust` — the latter has no `rustup target add`, so no `wasm32-unknown-unknown` std.
- `wasm-bindgen` must be exactly `0.2.104`, matching the `Cargo.toml` pin; the CLI rejects a `.wasm` built by another
  version. Brew's is newer, so install it via cargo.
- **`llvm` is required on macOS.** Apple's clang has no wasm32 target, so `blst`'s C build fails with
  `unable to create target`. The build script wires `CC_wasm32_unknown_unknown` to it automatically.
