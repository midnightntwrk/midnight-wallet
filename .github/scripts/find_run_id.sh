#!/bin/bash
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


# Usage: ./script.sh <owner/repo> <workflow_name> <artifact_name>
REPO="$1"
WORKFLOW_NAME="$2"
ARTIFACT_NAME="$3"

# Check if all arguments are provided
if [[ -z "$REPO" || -z "$WORKFLOW_NAME" || -z "$ARTIFACT_NAME" ]]; then
  echo "Usage: $0 <owner/repo> <workflow_name> <artifact_name>"
  exit 1
fi

# Fetch the workflow ID for the specified workflow
workflow_id=$(gh api repos/$REPO/actions/workflows | jq -r --arg name "$WORKFLOW_NAME" '.workflows[] | select(.name == $name) | .id')

if [[ -z "$workflow_id" ]]; then
  echo "Workflow '$WORKFLOW_NAME' not found in repository '$REPO'."
  exit 1
fi

# The runs that still hold a downloadable artifact of this name, newest first. An expired artifact is still listed but
# can no longer be downloaded, so it is left out.
#
# A run's conclusion is deliberately not checked. The sync cache only ever holds snapshots that passing tests saved, so
# a failed run's cache is as usable as a green run's. Requiring a green run deadlocks a lane that has been red for longer
# than the artifact retention period: every run syncs from scratch, times out, fails, and so never publishes the cache
# that would let the next run pass.
#
# Starting from the artifacts rather than from the workflow's runs keeps the number of API calls bounded by the few
# artifacts that exist, instead of growing with the length of the workflow's history.
candidate_runs=$(gh api "repos/$REPO/actions/artifacts?name=$ARTIFACT_NAME&per_page=100" --paginate \
  | jq -r '.artifacts[] | select(.expired == false) | "\(.created_at) \(.workflow_run.id)"' \
  | sort -r | awk '{print $2}')

# The newest of them that belongs to the specified workflow.
for run_id in $candidate_runs; do
  run_workflow_id=$(gh api "repos/$REPO/actions/runs/$run_id" --jq '.workflow_id')

  if [[ "$run_workflow_id" == "$workflow_id" ]]; then
    echo "$run_id"
    exit 0
  fi
done

echo "No runs of '$WORKFLOW_NAME' with an unexpired artifact named '$ARTIFACT_NAME' found." >&2
exit 1
