#!/usr/bin/env bash
# This file is part of MIDNIGHT-WALLET-SDK.
# Copyright (C) Midnight Foundation
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# You may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Decides whether a pull request's changes can alter a test result.
#
# Usage: ci-test-scope.sh <base-sha> <head-sha>
#
# Diffs <head-sha> against its merge-base with <base-sha> and prints `run-tests=true` unless every changed file is on
# the skip list below, then `run-tests=false`. The line also goes to $GITHUB_OUTPUT when that is set. The skip list is
# an allow-list on purpose: a file nobody thought of runs every test.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <base-sha> <head-sha>" >&2
  exit 2
fi

# Files no test, build or test fixture reads. Anything else — including every JSON file other than these two, since
# package.json, tsconfig*.json and turbo.json change the build — runs the full suite. In a `case` pattern `*` also
# matches `/`, so `*.md` covers Markdown at any depth and `docs/*` the whole tree.
on_skip_list() {
  case "$1" in
    *.md) return 0 ;;
    docs/*) return 0 ;;
    .changeset/pre.json | .changeset/config.json) return 0 ;;
    .claude/*) return 0 ;;
    LICENSE) return 0 ;;
    .github/ISSUE_TEMPLATE/*) return 0 ;;
    *) return 1 ;;
  esac
}

decide() {
  echo "run-tests=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "run-tests=$1" >> "$GITHUB_OUTPUT"
  fi
}

# --no-renames reports a rename as a deletion plus an addition, so moving `x.ts` to `x.md` still names `x.ts`.
changed="$(git diff --name-only --no-renames "$1...$2")"

if [ -z "$changed" ]; then
  echo "No changed files against the merge-base; running the full suite."
  decide true
  exit 0
fi

outside="$(while IFS= read -r file; do on_skip_list "$file" || echo "$file"; done <<< "$changed")"

if [ -n "$outside" ]; then
  echo "Files not on the skip list; running the full suite:"
  echo "$outside" | sed 's/^/  /'
  decide true
else
  echo "Every changed file is on the skip list; skipping the test jobs:"
  echo "$changed" | sed 's/^/  /'
  decide false
fi
