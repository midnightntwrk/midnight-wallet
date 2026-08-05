#!/usr/bin/env bash
# Build the v8-to-v9 state translation WASM artifact that this package loads.
#
# Output: wasm/pkg/, which is exactly where the loader looks by default. Run from anywhere; paths are resolved relative
# to this script.
#
# Requires a Rust toolchain with the wasm32-unknown-unknown target, wasm-bindgen 0.2.104, and wasm-opt. See ../README.md.
set -euo pipefail

package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate_dir="$package_dir/wasm"
out_dir="$crate_dir/pkg"
crate_lib=v8_to_v9_state_translation_wasm

# `wasm-bindgen` must match the `wasm-bindgen` crate version pinned in Cargo.toml exactly; it rejects a .wasm produced
# by any other version, so fail here with a clear reason rather than mid-build.
required_bindgen=0.2.104
for tool in cargo wasm-bindgen wasm-opt; do
  command -v "$tool" >/dev/null || {
    echo "error: $tool not found on PATH. See $package_dir/README.md for the toolchain." >&2
    exit 1
  }
done
have_bindgen="$(wasm-bindgen --version | awk '{print $2}')"
[ "$have_bindgen" = "$required_bindgen" ] || {
  echo "error: wasm-bindgen $required_bindgen required, found $have_bindgen." >&2
  echo "       cargo install wasm-bindgen-cli --version $required_bindgen --locked" >&2
  exit 1
}

# Apple's clang cannot target wasm32, so the C dependencies (blst) need an LLVM that can. The stack protector pulls in
# OS code that does not exist on wasm — the same reason midnight-ledger's nix build disables it.
if [ "$(uname -s)" = "Darwin" ] && [ -z "${CC_wasm32_unknown_unknown:-}" ]; then
  llvm_prefix="$(brew --prefix llvm 2>/dev/null || true)"
  [ -x "$llvm_prefix/bin/clang" ] || {
    echo "error: a wasm32-capable clang is required; Apple's has no wasm32 target. Try: brew install llvm" >&2
    exit 1
  }
  export CC_wasm32_unknown_unknown="$llvm_prefix/bin/clang"
  export AR_wasm32_unknown_unknown="$llvm_prefix/bin/llvm-ar"
  export CFLAGS_wasm32_unknown_unknown="-fno-stack-protector"
fi

echo "building $crate_lib for wasm32-unknown-unknown"
# Run from the crate directory, not with --manifest-path: Cargo discovers `.cargo/config.toml` from the working
# directory, and the crate's config carries any local dependency overrides.
(cd "$crate_dir" && cargo build --target wasm32-unknown-unknown --profile wasm)

rm -rf "$out_dir"
wasm-bindgen "$crate_dir/target/wasm32-unknown-unknown/wasm/$crate_lib.wasm" \
  --out-dir "$out_dir" --target experimental-nodejs-module --weak-refs --reference-types --no-typescript

wasm-opt "$out_dir/${crate_lib}_bg.wasm" -Os --enable-reference-types -o "$out_dir/${crate_lib}_bg.wasm"

cp "$package_dir/wasm/v8-to-v9-state-translation.d.ts" "$out_dir/$crate_lib.d.ts" 2>/dev/null || true

echo "built $out_dir ($(du -h "$out_dir/${crate_lib}_bg.wasm" | cut -f1) of wasm)"
