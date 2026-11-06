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

# The gate behind the required `Tests` check: decides from the results of the jobs it needs whether a CI run passed.
#
# Usage: RUN_TESTS=<decision> SCOPE=<result> BUILD=<result> GENERAL=<result> UNIT=<result> INTEGRATION=<result> \
#          E2E=<result> SERIALIZATION=<result> ci-tests-gate.sh
#
# RUN_TESTS is Test Scope's decision (`true` or `false`); the others are job results (`success`, `failure`,
# `cancelled`, `skipped`). It passes in exactly two cases: Test Scope, Build and General Checks succeeded and either the
# decision was `true` and every test stage succeeded, or it was `false` and every test stage was skipped. Anything else
# fails, naming the first job whose result is not the expected one. A stage skipped because something before it failed
# (Integration Tests after a failed Build WASM Translation) is a failure on a `true` decision.
#
# Every job gated on Test Scope's decision must be passed in here and checked, or a failure in it could pass the gate.

set -euo pipefail

echo "run-tests=${RUN_TESTS:-} scope=${SCOPE:-} build=${BUILD:-} general=${GENERAL:-}"
echo "unit=${UNIT:-} integration=${INTEGRATION:-} e2e=${E2E:-} serialization=${SERIALIZATION:-}"

# Fails, naming the job, when its result is not the one expected.
expect() {
  if [ "$2" != "$3" ]; then
    echo "::error::$1 was $2; expected $3."
    exit 1
  fi
}

expect "Test Scope" "${SCOPE:-}" success
expect "Build" "${BUILD:-}" success
expect "General Checks" "${GENERAL:-}" success

case "${RUN_TESTS:-}" in
  true)
    expected=success
    closing="All test stages passed."
    ;;
  false)
    expected=skipped
    closing="No file this change touches can alter a test result; test stages skipped by design."
    ;;
  *)
    echo "::error::Test Scope gave no decision (run-tests='${RUN_TESTS:-}')."
    exit 1
    ;;
esac

expect "Unit Tests" "${UNIT:-}" "$expected"
expect "Integration Tests" "${INTEGRATION:-}" "$expected"
expect "Smoke E2E" "${E2E:-}" "$expected"
expect "Serialization Formats" "${SERIALIZATION:-}" "$expected"
echo "$closing"
