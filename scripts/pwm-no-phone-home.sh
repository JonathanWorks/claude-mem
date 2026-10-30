#!/usr/bin/env bash
# pwm-no-phone-home.sh [--list]
#
# PWM fork guard (Jonathan 2026-10-30: "Remove all telemetry and begware, all cmem.ai references.
# Nothing ships every attempt to phone home to cmem or anything from the vendor").
#
# Scans the repository's files with `git grep` (tracked plus untracked, hidden files included,
# .gitignore not consulted for tracked files), so it needs only git and sees exactly what a commit
# carries. It fails CLOSED: any error from git grep, or a scope folder that does not exist, is a
# failure, never an "OK".
#
# Two tiers:
#   SHIPPED  everything the plugin, hub and integrations install: no vendor host, telemetry SDK,
#            hosted-plan or upsell text at all.
#   SOURCE   src/, which also builds the npx installer and keeps unreachable hosted-plan code: no
#            vendor endpoint of any shape (host, GitHub API or raw content, marketplace source).
set -euo pipefail

cd "$(dirname "$0")/.."
command -v git >/dev/null || { echo "FAIL: git is required" >&2; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "FAIL: not a git work tree" >&2; exit 2; }

SHIPPED=(plugin services .claude-plugin claude-mem-cursor claude-mem-grok-bot cursor-hooks openclaw install)
SHIPPED_PATTERN='(cmem|claude-mem)\.ai|posthog|cmem[ -]?pro([^a-z0-9]|$)|cmem[ -]?cloud|teambrain|free trial|pro[-_ ]trial|PRO_TRIAL|buymeacoffee|patreon\.com|api\.github\.com/repos/thedotmack|githubusercontent\.com/thedotmack'
SOURCE_PATTERN='(cmem|claude-mem)\.ai|posthog|api\.github\.com/repos/thedotmack|githubusercontent\.com/thedotmack|github\.com/thedotmack/claude-mem\.git|repo["'"'"'`]?[[:space:]]*:[[:space:]]*["'"'"'`]thedotmack/claude-mem'
# Not code that runs: lockfile funding metadata, source maps, upstream's changelog of past releases.
EXCLUDES=(':(exclude,glob)**/package-lock.json' ':(exclude,glob)**/bun.lock' ':(exclude,glob)**/*.map' ':(exclude)CHANGELOG.md')

for dir in "${SHIPPED[@]}" src; do
  [ -e "$dir" ] || { echo "FAIL: scope folder $dir is missing; update the guard" >&2; exit 2; }
done

# One git grep pass; prints matches; returns 0 on matches, 1 when clean, 2+ on error.
grep_pass() {
  local mode=$1 pattern=$2
  shift 2
  git grep ${mode:+"$mode"} -I -n -i -E -e "$pattern" -- "$@" "${EXCLUDES[@]}" \
    ':(exclude,glob)**/*.test.*' ':(exclude,glob)**/test-*.sh'
}

# Prints matches; returns 0 when clean, 1 when there are matches, 2 on any git grep error.
# Pass 1 reads every TRACKED file and consults no .gitignore (a committed file is shipped even if a
# nested .gitignore names it). Pass 2 adds untracked files that are not ignored, so a new file is
# caught before it is committed. (`--untracked` alone would apply .gitignore to tracked files too.)
scan() {
  local pattern=$1
  shift
  local rc1=0 rc2=0
  grep_pass "" "$pattern" "$@" || rc1=$?
  grep_pass --untracked "$pattern" "$@" || rc2=$?
  if [ "$rc1" -gt 1 ] || [ "$rc2" -gt 1 ]; then
    echo "FAIL: git grep exited $rc1/$rc2" >&2
    return 2
  fi
  if [ "$rc1" -eq 0 ] || [ "$rc2" -eq 0 ]; then return 1; fi
  return 0
}

out_shipped=$(scan "$SHIPPED_PATTERN" "${SHIPPED[@]}" | sort -u) && shipped=0 || shipped=$?
out_source=$(scan "$SOURCE_PATTERN" src | sort -u) && source=0 || source=$?

if [ "$shipped" -eq 2 ] || [ "$source" -eq 2 ]; then exit 2; fi
if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "$out_shipped" "$out_source" | sed '/^$/d'
fi
if [ "$shipped" -ne 0 ] || [ "$source" -ne 0 ]; then
  n=$(printf '%s\n' "$out_shipped" "$out_source" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "${1:-}" != "--list" ]; then
    printf '%s\n' "$out_shipped" "$out_source" | sed '/^$/d' | cut -d: -f1 | sort | uniq -c | sort -rn
  fi
  echo "FAIL: $n phone-home / upsell reference(s) (run with --list for each one)"
  exit 1
fi
echo "OK: no phone-home or upsell references in ${SHIPPED[*]}, and no vendor endpoint in src/"
