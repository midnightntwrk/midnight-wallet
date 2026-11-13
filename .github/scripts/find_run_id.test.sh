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

# Table test for find_run_id.sh, which picks the run whose sync cache artifact a healthcheck restores.
#
# Usage: find_run_id.test.sh [script]
#
# Each row describes the repository's runs and `.sync_cache` artifacts, serves them through a fake `gh` on PATH, and
# checks the script's exit code and the run id it prints. Pass another copy of the script (for example the base
# branch's) to see which rows it gets wrong; the fake also answers the run and per-run artifact listings the earlier
# version of the script used.
#
# Exits non-zero when any row fails, after printing every failure.

set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/find_run_id.sh"
script="${1:-$script}"

stub_dir="$(mktemp -d)"
trap 'rm -rf "$stub_dir"' EXIT

# The fake `gh api`. RUNS is a JSON array of {id, workflow_id, conclusion, branch}, newest first; ARTIFACTS a JSON array
# of {run, created_at, expired}; PAGE_SIZE splits the artifact listing into pages; FAIL makes any path containing it
# fail the way the real API does.
cat >"$stub_dir/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
shift # api
path="$1"
shift
jq_expr=""
slurp=false
paginate=false
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) jq_expr="$2"; shift 2 ;;
    --slurp) slurp=true; shift ;;
    --paginate) paginate=true; shift ;;
    *) shift ;;
  esac
done
if [ -n "${FAIL:-}" ] && [[ "$path" == *"$FAIL"* ]]; then
  echo "HTTP 502: Bad Gateway (https://api.github.com/$path)" >&2
  exit 1
fi
path="${path%%\?*}"
runs="${RUNS:-[]}"
artifacts="$(jq -c --argjson runs "$runs" '[.[] | . as $a | {name: ".sync_cache", expired, created_at,
  workflow_run: {id: .run, head_branch: ($runs[] | select(.id == $a.run) | .branch)}}]' <<<"${ARTIFACTS:-[]}")"
case "$path" in
  */actions/workflows)
    pages='[{"workflows":[{"name":"Healthcheck - preprod","id":7},{"name":"Healthcheck - preview","id":8}]}]' ;;
  */actions/artifacts)
    pages="$(jq -c --argjson size "${PAGE_SIZE:-100}" \
      '[range(0; ([length, 1] | max); $size) as $i | {artifacts: .[$i:$i + $size]}]' <<<"$artifacts")" ;;
  */actions/workflows/*/runs)
    id="$(basename "$(dirname "$path")")"
    pages="$(jq -c --argjson id "$id" '[{workflow_runs: [.[] | select(.workflow_id == $id)
      | {id, status: "completed", conclusion}]}]' <<<"$runs")" ;;
  */actions/runs/*/artifacts)
    id="$(basename "$(dirname "$path")")"
    pages="$(jq -c --argjson id "$id" '[{artifacts: [.[] | select(.workflow_run.id == $id)]}]' <<<"$artifacts")" ;;
  */actions/runs/*)
    id="$(basename "$path")"
    run="$(jq -c --argjson id "$id" '.[] | select(.id == $id)' <<<"$runs")"
    if [ -z "$run" ]; then
      echo "HTTP 404: Not Found (https://api.github.com/$path)" >&2
      exit 1
    fi
    pages="[$run]" ;;
  *)
    echo "unexpected path $path" >&2
    exit 1 ;;
esac
if $slurp; then
  out="$pages"
elif $paginate; then
  out="$(jq -c '.[]' <<<"$pages")"
else
  out="$(jq -c '.[0]' <<<"$pages")"
fi
if [ -n "$jq_expr" ]; then
  jq -r "$jq_expr" <<<"$out"
else
  printf '%s\n' "$out"
fi
STUB
chmod +x "$stub_dir/gh"

failures=0
rows=0

# check <label> <exit> <run-id> <runs> <artifacts> [VAR=value...]
check() {
  local label="$1" want_status="$2" want_id="$3" runs="$4" artifacts="$5"
  shift 5
  rows=$((rows + 1))

  local stdout status=0
  stdout="$(env PATH="$stub_dir:$PATH" RUNS="$runs" ARTIFACTS="$artifacts" "$@" \
    bash "$script" owner/repo "Healthcheck - preprod" .sync_cache main 2>/dev/null)" || status=$?

  if [ "$status" -ne "$want_status" ] || [ "$stdout" != "$want_id" ]; then
    failures=$((failures + 1))
    printf 'FAIL  %s\n' "$label"
    printf '      expected exit %s, run [%s]\n' "$want_status" "$want_id"
    printf '      got      exit %s, run [%s]\n' "$status" "$stdout"
  else
    printf 'ok    %s\n' "$label"
  fi
}

# Runs of the preprod lane (workflow 7) and of another workflow (8), newest first.
runs='[
  {"id": 150, "workflow_id": 7, "conclusion": "failure", "branch": "main"},
  {"id": 140, "workflow_id": 7, "conclusion": "success", "branch": "main"},
  {"id": 130, "workflow_id": 8, "conclusion": "success", "branch": "main"},
  {"id": 120, "workflow_id": 7, "conclusion": "failure", "branch": "feature"},
  {"id": 110, "workflow_id": 7, "conclusion": "success", "branch": "feature"}
]'
artifact() { printf '{"run": %s, "created_at": "2026-11-%sT00:00:00Z", "expired": %s}' "$1" "$2" "${3:-false}"; }

# The cache a red lane depends on: a failed run's artifact is as usable as a green run's.
check "the newest artifact belongs to a failed run" 0 150 "$runs" "[$(artifact 150 13), $(artifact 140 12)]"

# Artifacts that cannot or must not be restored are passed over.
check "an expired artifact is skipped" 0 140 "$runs" "[$(artifact 150 13 true), $(artifact 140 12)]"
check "another workflow's artifact is skipped" 0 140 "$runs" "[$(artifact 130 13), $(artifact 140 12)]"

# Newest means newest by creation, across every page of the listing.
check "artifacts listed out of order" 0 150 "$runs" "[$(artifact 140 12), $(artifact 150 13)]"
check "the newest artifact is on the second page" 0 150 "$runs" "[$(artifact 140 12), $(artifact 150 13)]" PAGE_SIZE=1

# The branch being tested is preferred, and any branch is the fallback.
check "the branch's artifact wins over a newer one from another branch" 0 140 "$runs" \
  "[$(artifact 120 13), $(artifact 140 12)]"
check "another branch's artifact when the branch has none" 0 120 "$runs" "[$(artifact 120 13), $(artifact 110 12)]"

# Nothing to restore is not an error.
check "no artifact of this workflow" 1 "" "$runs" "[$(artifact 130 13)]"
check "no artifacts at all" 1 "" "$runs" "[]"

# A failed API call is reported as such, never as an empty cache or as a different, older run.
check "the artifact listing fails" 2 "" "$runs" "[$(artifact 150 13)]" FAIL=actions/artifacts
check "the workflow listing fails" 2 "" "$runs" "[$(artifact 150 13)]" FAIL=actions/workflows
check "reading the newest candidate's run fails" 2 "" "$runs" "[$(artifact 150 13), $(artifact 140 12)]" \
  FAIL=actions/runs/150

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures of $rows rows failed."
  exit 1
fi
echo "All $rows rows passed."
