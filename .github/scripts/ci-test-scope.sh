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

# Decides whether a CI run's changes can alter a test result.
#
# Usage: EVENT_NAME=<event> HEAD_REF=<head-ref> BASE_REF=<base-ref> ci-test-scope.sh
#
# Takes no arguments. Run it inside the checked-out merge commit of a pull request, where HEAD^1 is the base tip and
# HEAD^2 the branch tip. The first rule that matches decides, in this order:
#
#   1. EVENT_NAME is not `pull_request`                → run-tests=true
#   2. HEAD_REF matches `changeset-release/*`          → run-tests=true
#   3. BASE_REF is not `main`                          → run-tests=true
#   4. no file changed between HEAD^1...HEAD^2         → run-tests=true
#   5. a changed file is not on the skip list below    → run-tests=true
#   6. every changed file is on the skip list          → run-tests=false
#
# The diff is against the merge-base of the two parents, so code `main` gained after the branch point never counts as
# the branch's change. Each rule prints its reason, then `run-tests=<value>`; the same line goes to $GITHUB_OUTPUT when
# that is set. The skip list is an allow-list on purpose: a file nobody thought of runs every test.

set -euo pipefail

# Files no test, test fixture or package build reads; General Checks still reads Markdown (formatting and lint), and it
# runs on every change. Anything else — including every JSON file other than these two, since package.json,
# tsconfig*.json and turbo.json change the build — runs the full suite. In a `case` pattern `*` also
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

# The only place a decision is written.
decide() {
  printf 'run-tests=%s\n' "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'run-tests=%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

# Prints each file name on its own indented line. File names go through printf, never echo, so a name such as `-n` is
# printed rather than read as an option.
list_files() {
  local file
  for file in "$@"; do printf '  %s\n' "$file"; done
}

if [ "${EVENT_NAME:-}" != "pull_request" ]; then
  printf 'Event %s is not a pull request; running the full suite.\n' "${EVENT_NAME:-<unset>}"
  decide true
  exit 0
fi

case "${HEAD_REF:-}" in
  changeset-release/*)
    printf 'Branch %s is a changesets release branch; running the full suite.\n' "$HEAD_REF"
    decide true
    exit 0
    ;;
esac

if [ "${BASE_REF:-}" != "main" ]; then
  printf 'Pull request targets %s, not main; running the full suite.\n' "${BASE_REF:-<unset>}"
  decide true
  exit 0
fi

# -z keeps every name verbatim (no quoting of non-ASCII or special characters, no newline ambiguity). --no-renames
# reports a rename as a deletion plus an addition, so moving `x.ts` to `x.md` still names `x.ts`. The diff goes to a
# file first so a git failure stops the script instead of reading as an empty diff.
diff_file="$(mktemp)"
trap 'rm -f "$diff_file"' EXIT
git diff -z --name-only --no-renames 'HEAD^1...HEAD^2' > "$diff_file"

changed=()
outside=()
while IFS= read -r -d '' file; do
  changed+=("$file")
  on_skip_list "$file" || outside+=("$file")
done < "$diff_file"

if [ "${#changed[@]}" -eq 0 ]; then
  echo "No changed files against the merge-base; running the full suite."
  decide true
elif [ "${#outside[@]}" -ne 0 ]; then
  echo "Files not on the skip list; running the full suite:"
  list_files "${outside[@]}"
  decide true
else
  echo "Every changed file is on the skip list; skipping the test jobs:"
  list_files "${changed[@]}"
  decide false
fi
