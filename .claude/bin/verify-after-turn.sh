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

# Stop hook helper: run `yarn lint` and `yarn test` against the packages
# with changes since HEAD (uncommitted edits + new commits).
#
# Turbo's --filter='[HEAD]' resolves to zero packages when nothing has
# changed, so the hook is near-instant on no-op turns. On lint or test
# failure, print a tail of the output and exit 2 — the hook is configured
# with asyncRewake, so exit 2 wakes Claude with the output as context.

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

log=$(yarn lint --filter='[HEAD]' 2>&1)
status=$?
if [ "$status" -ne 0 ]; then
  echo "[verify-after-turn] yarn lint failed (exit $status). Last lines:"
  echo "$log" | tail -60
  exit 2
fi

log=$(yarn test --filter='[HEAD]' 2>&1)
status=$?
if [ "$status" -ne 0 ]; then
  echo "[verify-after-turn] yarn test failed (exit $status). Last lines:"
  echo "$log" | tail -60
  exit 2
fi

exit 0
