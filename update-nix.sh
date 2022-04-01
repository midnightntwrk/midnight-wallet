#!/usr/bin/env nix-shell
#!nix-shell -i bash -p gnused coreutils

set -eo pipefail

name=$(basename $0)
file_with_hash="flake.nix"

usage() {
        echo "$name - Tool used to validate and update the sbt nix build"
        echo ""
        echo "USAGE:"
        echo "    $name [--check]"
        echo ""
        echo "OPTIONS:"
        echo -e "    --check\t Check whether $file_with_hash is up-to-date"
}

if [ "$1" == "-h" -o "$1" == "--help" ]; then
        usage
        exit 1
fi

echo "Determining new sha for sbt build, this can take several minutes to do a 'sbt dist'"

NEW_SHA=$((nix-build -E 'with import ./.; default.deps.overrideAttrs( _: { outputHash = "0000000000000000000000000000000000000000000000000000"; })' 2>&1 || true) | grep "  got: " | head -n 1 | sed -r 's/\s+got:\s+//' | xargs nix-hash --to-base32 --type sha256 )
echo "Calculated sha: $NEW_SHA"
update_sha() {
        echo "Updating sha in $file_with_hash"
        sed -r -i -e "s|depsSha256 = \"[^\"]+\";|depsSha256 = \"${NEW_SHA}\";|" "$file_with_hash"
        echo "$file_with_hash has been updated"
}
if [ $# == 1 -o "$1" == "--check" ]; then
        current_sha=$(cat "$file_with_hash" | grep depsSha256 | sed 's/\s*depsSha256\s*=\s*//g' | sed -e 's/"//g' -e 's/;//g' | xargs nix-hash --to-base32 --type sha256 )
        if [ "$current_sha" == "$NEW_SHA" ]; then
                echo "$file_with_hash is up-to-date"
                exit 0
        else
                echo "wanted: $NEW_SHA"
                echo "   got: $current_sha"
                update_sha
                exit 1
        fi
fi
update_sha
