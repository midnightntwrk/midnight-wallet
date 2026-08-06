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
vendor_dir="$crate_dir/.vendor"
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

# ---------------------------------------------------------------------------
# Vendor `midnight-storage` with the wasm-safe clock patch.
#
# Its metered translation loop calls `std::time::Instant::now()`, which is unimplemented on wasm32-unknown-unknown and
# traps. Until a release carries the fix, the published source is fetched and patched here, and `Cargo.toml`'s
# `[patch.crates-io]` points at the result. Delete all of this — the patch, this block, and that `[patch]` entry — once
# a published `midnight-storage` has it.
#
# The version comes from Cargo.lock, so this tracks whatever is actually resolved. If the patch stops applying, the
# crate has moved and the patch needs regenerating; that is a hard failure rather than a silently unpatched build.
# ---------------------------------------------------------------------------
storage_patch="$crate_dir/patches/midnight-storage-wasm-instant.patch"
storage_version="$(awk '/^name = "midnight-storage"$/ { found = 1; next }
                        found && /^version = / { gsub(/[",]/, "", $3); print $3; exit }' "$crate_dir/Cargo.lock")"
[ -n "$storage_version" ] || {
  echo "error: could not read the midnight-storage version from $crate_dir/Cargo.lock" >&2
  exit 1
}

storage_dir="$vendor_dir/midnight-storage"
stamp="$storage_dir/.patched-version"
if [ "$(cat "$stamp" 2>/dev/null || true)" != "$storage_version" ]; then
  echo "vendoring midnight-storage $storage_version with the wasm clock patch"
  rm -rf "$storage_dir"
  mkdir -p "$vendor_dir"
  curl -sSfL "https://static.crates.io/crates/midnight-storage/midnight-storage-${storage_version}.crate" \
    | tar xz -C "$vendor_dir"
  mv "$vendor_dir/midnight-storage-${storage_version}" "$storage_dir"
  patch -p1 -s -d "$storage_dir" <"$storage_patch" || {
    echo "error: $storage_patch does not apply to midnight-storage $storage_version." >&2
    echo "       The crate has moved; regenerate the patch (see ../README.md) or drop it if the fix is now released." >&2
    exit 1
  }
  echo "$storage_version" >"$stamp"
fi

# The stack protector pulls in OS code that does not exist on wasm — the same reason midnight-ledger's nix build
# disables it. Apple's clang additionally cannot target wasm32 at all, so the C dependencies (blst) need an LLVM that
# can; Linux distributions' clang already does.
export CFLAGS_wasm32_unknown_unknown="${CFLAGS_wasm32_unknown_unknown:--fno-stack-protector}"
if [ "$(uname -s)" = "Darwin" ] && [ -z "${CC_wasm32_unknown_unknown:-}" ]; then
  llvm_prefix="$(brew --prefix llvm 2>/dev/null || true)"
  [ -x "$llvm_prefix/bin/clang" ] || {
    echo "error: a wasm32-capable clang is required; Apple's has no wasm32 target. Try: brew install llvm" >&2
    exit 1
  }
  export CC_wasm32_unknown_unknown="$llvm_prefix/bin/clang"
  export AR_wasm32_unknown_unknown="$llvm_prefix/bin/llvm-ar"
fi

echo "building $crate_lib for wasm32-unknown-unknown"
# Run from the crate directory, not with --manifest-path: Cargo discovers `.cargo/config.toml` from the working
# directory, and the crate's config may carry local dependency overrides.
(cd "$crate_dir" && cargo build --target wasm32-unknown-unknown --profile wasm)

rm -rf "$out_dir"
wasm-bindgen "$crate_dir/target/wasm32-unknown-unknown/wasm/$crate_lib.wasm" \
  --out-dir "$out_dir" --target experimental-nodejs-module --weak-refs --reference-types --no-typescript

wasm-opt "$out_dir/${crate_lib}_bg.wasm" -Os --enable-reference-types -o "$out_dir/${crate_lib}_bg.wasm"

cp "$crate_dir/v8-to-v9-state-translation.d.ts" "$out_dir/$crate_lib.d.ts"

echo "built $out_dir ($(wc -c <"$out_dir/${crate_lib}_bg.wasm" | tr -d ' ') bytes of wasm)"
