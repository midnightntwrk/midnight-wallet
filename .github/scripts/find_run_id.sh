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

# Prints the id of the run whose artifact named <artifact_name> the workflow <workflow_name> should restore.
#
# Usage: find_run_id.sh <owner/repo> <workflow_name> <artifact_name> [branch]
#
# Exits 0 with the run id, 1 when there is no such artifact, and 2 when the GitHub API could not be read, so that a
# failed lookup is not reported as an empty cache.

set -o pipefail

REPO="${1:-}"
WORKFLOW_NAME="${2:-}"
ARTIFACT_NAME="${3:-}"
BRANCH="${4:-}"

if [[ -z "$REPO" || -z "$WORKFLOW_NAME" || -z "$ARTIFACT_NAME" ]]; then
  echo "Usage: $0 <owner/repo> <workflow_name> <artifact_name> [branch]" >&2
  exit 2
fi

if ! workflow_id=$(gh api "repos/$REPO/actions/workflows?per_page=100" --paginate --slurp \
  | jq -r --arg name "$WORKFLOW_NAME" '.[].workflows[] | select(.name == $name) | .id'); then
  echo "Could not list the workflows of '$REPO'." >&2
  exit 2
fi
# A network with no healthcheck workflow has no cache to restore, which is not an error.
if [[ -z "$workflow_id" ]]; then
  echo "Workflow '$WORKFLOW_NAME' not found in repository '$REPO'." >&2
  exit 1
fi

# Runs holding an unexpired artifact of this name: those on <branch> first, then the rest, newest first within each.
# The run's conclusion is not checked: the cache only holds snapshots that passing tests saved, and requiring a green
# run deadlocks a lane that stays red for longer than the retention period. Listing artifacts rather than runs keeps the
# API calls bounded by the unexpired artifacts of this name.
if ! candidate_runs=$(gh api "repos/$REPO/actions/artifacts?name=$ARTIFACT_NAME&per_page=100" --paginate --slurp \
  | jq -r --arg branch "$BRANCH" '[.[].artifacts[] | select(.expired | not)]
      | sort_by([(.workflow_run.head_branch == $branch), .created_at]) | reverse | .[].workflow_run.id'); then
  echo "Could not list the repository's artifacts named '$ARTIFACT_NAME'." >&2
  exit 2
fi

# The first of them that belongs to the workflow.
for run_id in $candidate_runs; do
  if ! run_workflow_id=$(gh api "repos/$REPO/actions/runs/$run_id" --jq '.workflow_id'); then
    echo "Could not read run $run_id." >&2
    exit 2
  fi
  if [[ "$run_workflow_id" == "$workflow_id" ]]; then
    echo "$run_id"
    exit 0
  fi
done

echo "No runs of '$WORKFLOW_NAME' with an unexpired artifact named '$ARTIFACT_NAME' found." >&2
exit 1
