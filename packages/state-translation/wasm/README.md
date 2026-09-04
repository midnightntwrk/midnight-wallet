# v8-to-v9-state-translation-wasm

WASM bindings for the ledger's v8-to-v9 ledger state translation. One export:

```typescript
export function translate_ledger_state(v8_bytes: Uint8Array): Uint8Array;
```

Built by `../scripts/build-wasm.sh` into `pkg/`, which `../src/` imports directly. A member of the workspace defined by
the repository-root `Cargo.toml`; nothing here is published.

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

Note the `[patch.crates-io]` block in the **repository-root `Cargo.toml`** — Cargo only honours `[patch]` there, which
is also why the `wasm` profile lives at the root. The ledger's v9 line is in pre-release and not on crates.io, its own
workspace redirects those crates to git tags, and consuming the translation from outside that workspace means
replicating the block. The standalone `v8-to-v9-state-translation-replay` crate does the same. **It has to be kept in
step when those tags move.**

## Iterating against a local checkout

Cargo's `paths` override swaps in a local copy without touching `Cargo.toml`. Create a gitignored `.cargo/config.toml`
here (the build script runs cargo from this directory, so it is picked up):

```toml
paths = ["/path/to/midnight-ledger/v8-to-v9-state-translation"]
```

## The vendored `midnight-storage` patch — temporary, and why it exists

`midnight-storage`'s `src/state_translation.rs` imports `std::time::Instant` and calls `Instant::now()` at eight sites
in the metered loop, including inside `run()`. That intrinsic is unimplemented on `wasm32-unknown-unknown` and traps, so
the first `run()` takes the translation down as `RuntimeError: unreachable` — the crate links fine and then dies on the
first real state. Verified in isolation: a wasm export whose whole body is `Instant::now()` traps identically.

`patches/midnight-storage-wasm-instant.patch` is a 24-line, cfg-gated switch to
[`web-time`](https://crates.io/crates/web-time), which re-exports `std::time` on non-wasm targets and backs `Instant`
with `performance.now()` on wasm — so every other target is byte-identical.

`../scripts/build-wasm.sh` applies it: it reads the resolved version from the root `Cargo.lock`, fetches that exact
published source from crates.io, patches it into `.vendor/midnight-storage` (gitignored), and the root `Cargo.toml`'s
`[patch.crates-io]` points there. **Drive cargo through the script**; a bare `cargo build` fails on the missing
directory, which is deliberate — the alternative is silently producing a wasm that traps.

If the patch stops applying, the crate has moved. Regenerate it against the new version rather than working around it:

```bash
cd wasm/.vendor && curl -sSfL https://static.crates.io/crates/midnight-storage/midnight-storage-<version>.crate | tar xz
# edit the extracted copy, then:
diff -u --label a/src/state_translation.rs --label b/src/state_translation.rs <pristine> <edited>
```

**The real fix has to be published, not just committed to the ledger repository** — this crate takes `midnight-storage`
from crates.io, and redirecting it to a local checkout does not work: the git-tagged v9 crates fail against the ledger
workspace's copy with 151 trait-mismatch errors in `midnight-onchain-state`, that copy having drifted past the released
one. Note this crate resolves **2.0.2**, which is newer than the 2.0.1 the ledger workspace pins, and 2.0.2 does not
contain the fix either.

Once a release does carry it, delete four things: this section, `patches/`, the `midnight-storage` entry in the root
`Cargo.toml`'s `[patch.crates-io]`, and the vendoring block in the build script.

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
rustup default stable
cargo install wasm-bindgen-cli --version 0.2.104 --locked
```

- `rustup`, not brew's `rust` — the latter cannot add targets, so no `wasm32-unknown-unknown` std.
- No `rustup target add` needed: the root `rust-toolchain.toml` pins the toolchain and lists the target, so rustup
  installs both on the first `cargo` invocation.
- `wasm-bindgen` must be exactly `0.2.104`, matching the `Cargo.toml` pin; the CLI rejects a `.wasm` built by another
  version. Brew's is newer, so install it via cargo.
- **`llvm` is required on macOS.** Apple's clang has no wasm32 target, so `blst`'s C build fails with
  `unable to create target`. The build script wires `CC_wasm32_unknown_unknown` to it automatically.
