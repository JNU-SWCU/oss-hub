#!/usr/bin/env bash
# Shared by the deploy and recover scripts. Source this file. Do not execute it.

classify_migrate_log() {
  local log="$1"
  local line
  while IFS= read -r line; do
    if [[ "$line" == *55P03* || "$line" == *OSS_HUB_LOCK_TIMEOUT* || "$line" == *"canceling statement due to lock timeout"* ]]; then
      printf 'lock_timeout\n%s\n' "$line"
      return 0
    fi
  done <<<"$log"
  while IFS= read -r line; do
    if [[ "$line" == *25P02* || "$line" == *"current transaction is aborted"* ]]; then
      continue
    fi
    if [[ "$line" == *ERROR:* ]]; then
      printf 'other\n%s\n' "$line"
      return 0
    fi
  done <<<"$log"
  while IFS= read -r line; do
    if [[ "$line" == *25P02* || "$line" == *"current transaction is aborted"* ]]; then
      continue
    fi
    if [[ "$line" == *P3009* || "$line" == *Error:* ]]; then
      printf 'other\n%s\n' "$line"
      return 0
    fi
  done <<<"$log"
  printf 'other\nunknown failure\n'
}
