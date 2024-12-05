#!/bin/bash

if ! command -v jq &> /dev/null; then
    echo "jq is required but it's not installed. Please install jq to proceed."
    exit 1
fi

BUN_VERSION="bun@$(bun -v)"
echo $BUN_VERSION

find . -path './node_modules/*' -prune -o -name 'package.json' | while read -r file; do
    jq --arg pm "$BUN_VERSION" '.packageManager = $pm' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
    
    if [ $? -eq 0 ]; then
        echo "Updated packageManager in $file"
    else
        echo "Failed to update $file"
    fi
done

echo "Finished updating packageManager in all package.json files."
