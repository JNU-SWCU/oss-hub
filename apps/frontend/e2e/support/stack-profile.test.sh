#!/usr/bin/env bash

set -euo pipefail

support_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$support_directory/stack-profile.sh"

calls=0

record_call() {
  calls=$((calls + 1))
}

fail_call() {
  return 73
}

test "$(e2e_stack_profile)" = full

for profile in full deadline-digest; do
  calls=0
  e2e_stack_profile_run_deadline_digest "$profile" record_call
  test "$calls" -eq 1

  status=0
  e2e_stack_profile_run_deadline_digest "$profile" fail_call || status=$?
  test "$status" -eq 73
done

calls=0
e2e_stack_profile_run_deadline_digest program-authoring record_call
test "$calls" -eq 0

if e2e_stack_profile invalid-profile >/dev/null 2>&1; then
  printf 'unknown stack profile must fail\n' >&2
  exit 1
fi

if E2E_STACK_PROFILE=invalid-profile bash "$support_directory/../run-stack.sh" >/dev/null 2>&1; then
  printf 'run-stack must reject an unknown profile before startup\n' >&2
  exit 1
fi

printf 'stack profile: ok\n'
