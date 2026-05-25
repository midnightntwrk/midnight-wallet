#!/usr/bin/env bash
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
