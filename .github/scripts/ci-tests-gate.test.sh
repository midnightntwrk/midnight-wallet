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

# Table test for ci-tests-gate.sh, the script behind the required `Tests` check.
#
# Usage: ci-tests-gate.test.sh [script]
#
# Each row sets the job results the `tests` job reads (RUN_TESTS, SCOPE, BUILD, GENERAL, UNIT, INTEGRATION, E2E,
# SERIALIZATION) and checks the gate's exit code and its last line: the closing message on a pass, the `::error::`
# line naming the job on a failure. The gate passes in exactly two cases, every stage ran and passed or Test Scope
# chose to skip and every stage was skipped; every other row must fail.
#
# Exits non-zero when any row fails, after printing every failure.

set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/ci-tests-gate.sh"
script="${1:-$script}"

failures=0
rows=0

# check <label> <exit> <last-line> <run-tests> <scope> <build> <general> <unit> <integration> <e2e> <serialization>
check() {
  local label="$1" want_status="$2" want_line="$3"
  shift 3
  rows=$((rows + 1))

  local stdout status=0
  stdout="$(RUN_TESTS="$1" SCOPE="$2" BUILD="$3" GENERAL="$4" UNIT="$5" INTEGRATION="$6" E2E="$7" SERIALIZATION="$8" \
    bash "$script" 2>&1)" || status=$?

  local last
  last="$(printf '%s\n' "$stdout" | tail -n 1)"

  if [ "$status" -ne "$want_status" ] || [ "$last" != "$want_line" ]; then
    failures=$((failures + 1))
    printf 'FAIL  %s\n' "$label"
    printf '      expected exit %s, last line [%s]\n' "$want_status" "$want_line"
    printf '      got      exit %s, last line [%s]\n' "$status" "$last"
  else
    printf 'ok    %s\n' "$label"
  fi
}

ran="All test stages passed."
skipped="No file this change touches can alter a test result; test stages skipped by design."
S=success
K=skipped

# The two ways to pass.
check "tests ran and passed" 0 "$ran" true $S $S $S $S $S $S $S
check "tests skipped by decision" 0 "$skipped" false $S $S $S $K $K $K $K

# The jobs every run needs, whatever the decision.
check "Test Scope failed" 1 "::error::Test Scope was failure; expected success." "" failure $S $S $K $K $K $K
check "Build failed, tests decided to run" 1 "::error::Build was failure; expected success." true $S failure $S $K $K $K $K
check "Build cancelled, tests decided to skip" 1 "::error::Build was cancelled; expected success." false $S cancelled $S $K $K $K $K
check "General Checks failed" 1 "::error::General Checks was failure; expected success." false $S $S failure $K $K $K $K

# A missing or unknown decision never passes.
check "no decision" 1 "::error::Test Scope gave no decision (run-tests='')." "" $S $S $S $K $K $K $K
check "malformed decision" 1 "::error::Test Scope gave no decision (run-tests='yes')." yes $S $S $S $S $S $S $S

# Tests decided to run: every stage must have passed.
check "Unit Tests failed" 1 "::error::Unit Tests was failure; expected success." true $S $S $S failure $S $S $S
check "Smoke E2E cancelled" 1 "::error::Smoke E2E was cancelled; expected success." true $S $S $S $S $S cancelled $S
check "Serialization Formats failed" 1 "::error::Serialization Formats was failure; expected success." \
  true $S $S $S $S $S $S failure
check "Integration Tests skipped because Build WASM Translation failed" 1 \
  "::error::Integration Tests was skipped; expected success." true $S $S $S $S $K $S $S

# Tests decided to skip: a stage that ran anyway means the decision and the jobs disagree.
check "Unit Tests ran on a skip decision" 1 "::error::Unit Tests was success; expected skipped." \
  false $S $S $S $S $K $K $K
check "Serialization Formats failed on a skip decision" 1 \
  "::error::Serialization Formats was failure; expected skipped." false $S $S $S $K $K $K failure

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures of $rows rows failed."
  exit 1
fi
echo "All $rows rows passed."
