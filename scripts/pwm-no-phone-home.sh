#!/usr/bin/env bash
# pwm-no-phone-home.sh [--list]
#
# PWM fork guard (Jonathan 2026-10-30: "Remove all telemetry and begware, all cmem.ai references.
# Nothing ships every attempt to phone home to cmem or anything from the vendor").
# Fails when anything the plugin ships, or the source it is built from, still references the
# vendor's cloud, its telemetry, or the paid-plan pitch. --list prints every hit; the default prints
# counts per pattern and per top-level directory.
set -euo pipefail

cd "$(dirname "$0")/.."

# One pattern per line: what must never ship. Case-insensitive.
PATTERNS=(
  'cmem\.ai'
  'posthog'
  'cmem[ -]?pro\b'
  'cmem[ -]?cloud'
  'teambrain'
  'free trial'
  'pro[-_ ]trial'
  'PRO_TRIAL'
  'buymeacoffee'
  'patreon\.com'
)
# What ships: the installed plugin (built bundles keep only strings and property names) and the hub.
# src/ is checked separately below for vendor URLs and the telemetry SDK, which would reach a bundle.
SCOPE=(plugin services)
# Not code that runs: lockfile funding metadata and upstream's changelog of past releases.
EXCLUDES=(--glob '!**/package-lock.json' --glob '!**/bun.lock' --glob '!**/*.map' --glob '!CHANGELOG.md')

regex=$(IFS='|'; printf '%s' "${PATTERNS[*]}")
if [ "${1:-}" = "--list" ]; then
  rg -a --no-mmap -n -i --no-heading "${EXCLUDES[@]}" -e "$regex" "${SCOPE[@]}" || true
  exit 0
fi

total=0
for p in "${PATTERNS[@]}"; do
  n=$( { rg -a --no-mmap -c -i "${EXCLUDES[@]}" -e "$p" "${SCOPE[@]}" 2>/dev/null || true; } | awk -F: '{s+=$NF} END {print s+0}')
  if [ "$n" -gt 0 ]; then printf '%6d  %s\n' "$n" "$p"; fi
  total=$((total + n))
done
if [ "$total" -gt 0 ]; then
  echo "--- by directory"
  rg -a --no-mmap -l -i "${EXCLUDES[@]}" -e "$regex" "${SCOPE[@]}" | awk -F/ '{print $1"/"$2}' | sort | uniq -c | sort -rn
  echo "FAIL: $total phone-home / upsell reference(s) still ship (run with --list for each one)"
  exit 1
fi
src_hits=$(rg -a --no-mmap -n -i "${EXCLUDES[@]}" --glob '!**/*.test.*' -e 'https?://[a-z0-9.-]*cmem\.ai' -e 'posthog' src || true)
if [ -n "$src_hits" ]; then
  printf '%s\n' "$src_hits"
  echo "FAIL: vendor URL or telemetry SDK still in src/"
  exit 1
fi
echo "OK: no phone-home or upsell references in ${SCOPE[*]}, and no vendor URL or telemetry SDK in src/"
