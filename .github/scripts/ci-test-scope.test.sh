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

# Table test for ci-test-scope.sh.
#
# Usage: ci-test-scope.test.sh [script]
#
# Each row builds a throwaway git repository shaped like the merge commit GitHub checks out for a pull request: a base
# commit on `main`, a branch commit holding the row's changes, and a `--no-ff` merge of the branch into `main`, so
# HEAD^1 is the base tip and HEAD^2 the branch tip. The script runs there with the row's EVENT_NAME, HEAD_REF and
# BASE_REF and must print the expected `run-tests=` line, and write the same line to $GITHUB_OUTPUT. A row whose
# expectation is wrong for the skip list is a test that should fail: the skip list is an allow-list, so every row that
# expects `false` names a file the list must keep, and every row expecting `true` a file it must never take.
#
# Exits non-zero when any row fails, after printing every failure.

set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/ci-test-scope.sh"
script="${1:-$script}"

# Isolate the throwaway repositories from the caller's git configuration: no hooks, signing or quoting overrides.
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0
rows=0

write_file() {
  mkdir -p -- "$(dirname -- "$1")"
  printf 'content of %s\n' "$1" > "./$1"
  git add -- "$1"
}

# Branch operations, run on the branch before its commit.
add() {
  local file
  for file in "$@"; do write_file "$file"; done
}
rename() { git mv -- "$1" "$2"; }
nothing() { :; }

# check <expected> <label> <event> <head-ref> <base-ref> <main-adds> <branch-op> [args...]
#
# <main-adds> is a file committed to `main` after the branch point, or `-` for none: it moves the base tip past the
# merge-base, so only a diff against the merge-base sees the branch's own changes.
check() {
  local expected="$1" label="$2" event="$3" head_ref="$4" base_ref="$5" main_adds="$6"
  shift 6
  rows=$((rows + 1))

  local repo="$work/row-$rows"
  mkdir -p "$repo"
  (
    cd "$repo"
    git init -q -b main
    write_file README.md
    write_file src/x.ts
    git commit -q -m base
    git switch -q -c branch
    "$@"
    git commit -q --allow-empty -m branch
    git switch -q main
    if [ "$main_adds" != "-" ]; then
      write_file "$main_adds"
      git commit -q -m "main moves on"
    fi
    git merge -q --no-ff --no-edit branch
  )

  local output_file="$repo.output" stdout status=0
  : > "$output_file"
  stdout="$(cd "$repo" && EVENT_NAME="$event" HEAD_REF="$head_ref" BASE_REF="$base_ref" GITHUB_OUTPUT="$output_file" \
    "$script" 2>&1)" || status=$?

  local printed written
  printed="$(printf '%s\n' "$stdout" | grep '^run-tests=' || true)"
  written="$(cat "$output_file")"

  if [ "$status" -ne 0 ] || [ "$printed" != "run-tests=$expected" ] || [ "$written" != "run-tests=$expected" ]; then
    failures=$((failures + 1))
    printf 'FAIL  %s\n' "$label"
    printf '      expected run-tests=%s; exit %s; printed [%s]; wrote [%s]\n' "$expected" "$status" "$printed" "$written"
    printf '%s\n' "$stdout" | sed 's/^/      | /'
  else
    printf 'ok    %s\n' "$label"
  fi
}

pr() { check "$1" "$2" pull_request feature/x main - "${@:3}"; }

# A change that can alter a test result runs every test.
pr true "package.json" add package.json
pr true "yarn.lock" add yarn.lock
pr true "tsconfig.json" add tsconfig.json
pr true ".changeset/foo.json (only pre.json and config.json are skippable)" add .changeset/foo.json
pr true ".github/workflows/x.yml" add .github/workflows/x.yml
pr true "src/x.ts renamed to src/x.md (the deleted name counts)" rename src/x.ts src/x.md
pr true ".changeset/pre.json with src/y.ts" add .changeset/pre.json src/y.ts
pr true "unknown root file foo" add foo
# Near misses: each name sits just outside one skip pattern, so widening that pattern fails its row.
pr true "scripts/x.mjs (outside *.md)" add scripts/x.mjs
pr true "LICENSE-x.sh (outside LICENSE)" add LICENSE-x.sh
pr true "docsx/y.ts (outside docs/)" add docsx/y.ts
pr true ".claudex/y.ts (outside .claude/)" add .claudex/y.ts
pr true ".github/ISSUE_TEMPLATEx.yml (outside .github/ISSUE_TEMPLATE/)" add .github/ISSUE_TEMPLATEx.yml
pr true "root file named -n with a.md (file names are never echo options)" add -n a.md
pr true "empty diff" nothing

# Events and branches that always run every test, whatever the files.
check true "push event" push "" "" - add a.md
check true "workflow_dispatch event" workflow_dispatch "" "" - add a.md
check true "changesets release branch" pull_request changeset-release/main main - add a.md
check true "docs-only pull request into a branch other than main" pull_request feature/x feature-x - add a.md

# Changes no test, test fixture or package build reads skip the test jobs.
pr false "a/b/c.md" add a/b/c.md
pr false "docs/x.svg" add docs/x.svg
pr false ".claude/s.json" add .claude/s.json
pr false "LICENSE" add LICENSE
pr false ".github/ISSUE_TEMPLATE/t.yml" add .github/ISSUE_TEMPLATE/t.yml
pr false ".changeset/pre.json" add .changeset/pre.json
pr false ".changeset/config.json" add .changeset/config.json
pr false "docs/café.md (non-ASCII names are matched unquoted)" add docs/café.md
pr false "release note with its changeset" add release-notes/v2.0.0.md .changeset/docs-release-notes.md
check false "docs-only branch after main gained code past the branch point" pull_request feature/x main src/y.ts add a.md

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures of $rows rows failed."
  exit 1
fi
echo "All $rows rows passed."
