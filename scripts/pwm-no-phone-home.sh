#!/usr/bin/env bash
# pwm-no-phone-home.sh [--list]
#
# PWM fork guard (Jonathan 2026-10-30: "Remove all telemetry and begware, all cmem.ai references.
# Nothing ships every attempt to phone home to cmem or anything from the vendor").
#
# Scans this repository with `git grep`, reading every file as text (`-a`: no binary detection, so
# .gitattributes, NUL bytes and encodings cannot hide a file). Tracked files are read with no
# .gitignore applied; untracked, non-ignored files are added so a new file is caught before it is
# committed. It fails CLOSED: a git error, a run from any repository but this one, or a scope entry
# with no tracked file is a failure, never an "OK".
#
# What it is for: catching vendor paths that an upstream merge re-introduces by accident, before the
# merge PR is reviewed. It is a text scan, not a sandbox: deliberately obfuscated endpoints (a host
# assembled from pieces at runtime, UTF-16 text) are out of reach, which is why every upstream sync
# lands as a reviewed pull request.
#
# Two tiers:
#   SHIPPED  everything installed or published: the plugin, the hub, the integrations, and every
#            path in package.json "files". No vendor host, telemetry SDK, hosted-plan or upsell text.
#   SOURCE   src/ (it builds dist/ and keeps unreachable hosted-plan code paths): no vendor
#            endpoint of any shape.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$root"
command -v git >/dev/null || { echo "FAIL: git is required" >&2; exit 2; }
top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$top" ] || [ "$(cd "$top" && pwd -P)" != "$root" ]; then
  echo "FAIL: run from this repository's own git work tree (found '${top:-none}')" >&2
  exit 2
fi

SHIPPED=(plugin services .claude-plugin claude-mem-cursor claude-mem-grok-bot cursor-hooks openclaw install)
# Everything npm publishes, except dist/ (built from src/, which the SOURCE tier covers).
command -v node >/dev/null || { echo "FAIL: node is required to read package.json files" >&2; exit 2; }
# package.json itself ships (its scripts run at install), and so do its main/bin/exports targets.
# Targets are normalised and validated: anything that is not a plain relative path inside the repo
# (git pathspec magic such as ":!plugin", "..", an absolute path) fails the guard rather than
# reaching git grep. README/LICENSE are not scanned: this fork does not publish to npm.
files_list="$(node -e '
const path = require("path");
const p = require("./package.json");
if (!Array.isArray(p.files) || p.files.length === 0) process.exit(3);
const bad = (why, v) => { console.error("unsafe package.json value (" + why + "): " + JSON.stringify(v)); process.exit(4); };
// One rule for files entries and main/bin/exports targets: a plain relative path inside the repo.
const clean = (v, globs) => {
  if (typeof v !== "string") bad("not a string", v);
  if (/[\u0000-\u001f\u007f]/.test(v)) bad("control character", v);
  let u = v.replace(/\/\*$/, "");
  // A files glob ships whatever it matches, so scan its whole parent directory (a superset).
  if (globs && /[*?\[\]{}!]/.test(u)) u = path.posix.dirname(u.slice(0, u.search(/[*?\[\]{}!]/)) + "x");
  if (/[*?\[\]{}!]/.test(u)) bad("glob character", v);
  const t = path.posix.normalize(u).replace(/^\.\//, "").replace(/\/$/, "");
  if (t.startsWith(":") || t.startsWith("/") || t === ".." || t.startsWith("../") || t.includes("/../")) bad("outside the repository", v);
  return t;
};
const out = new Set(["package.json"]);
for (const f of p.files) {
  const t = clean(f, true);
  if (t !== "." && t !== "dist" && !t.startsWith("dist/")) out.add(t);
}
const add = (v) => {
  if (typeof v === "string") { const t = clean(v); if (t !== "." && t !== "dist" && !t.startsWith("dist/")) out.add(t); }
  else if (v && typeof v === "object") Object.values(v).forEach(add);
};
add(p.main); add(p.bin); add(p.exports);
for (const e of out) console.log(e);
')" ||
  { echo "FAIL: could not read package.json \"files\"" >&2; exit 2; }
while IFS= read -r entry; do
  [ -n "$entry" ] && [ "$entry" != "dist" ] && SHIPPED+=("$entry")
done <<<"$files_list"
# dist/ is build output from src/ (the SOURCE tier). Anything committed under it is scanned as shipped.
if [ -n "$(git ls-files -- dist | head -1)" ]; then SHIPPED+=(dist); fi

SHIPPED_PATTERN='(cmem|claude-mem)\.ai|posthog|cmem[ -]?pro([^a-z0-9]|$)|cmem[ -]?cloud|teambrain|free trial|pro[-_ ]trial|PRO_TRIAL|buymeacoffee|patreon\.com|thedotmack\.github\.io|thedotmack/claude-mem\.git|(github|githubusercontent|codeload\.github)\.com/thedotmack|api\.github\.com/repos/thedotmack'
SOURCE_PATTERN='(cmem|claude-mem)\.ai|posthog|[a-z]+://[^[:space:]"'"'"'`]*thedotmack/claude-mem|/gh/thedotmack|thedotmack\.github\.io|github\.com[:/]thedotmack|githubusercontent\.com/thedotmack|repos/thedotmack|github:thedotmack|repo["'"'"'`]?[[:space:]]*:[[:space:]]*["'"'"'`]thedotmack/claude-mem'
# Not code that ships: npm lockfile funding metadata and upstream's changelog of past releases.
EXCLUDES=(':(exclude,glob)**/package-lock.json' ':(exclude)CHANGELOG.md')
SOURCE_EXCLUDES=()

for entry in "${SHIPPED[@]}" src; do
  if [ -z "$(git ls-files -- "$entry" | head -1)" ]; then
    echo "FAIL: scope entry '$entry' has no tracked file; update the guard" >&2
    exit 2
  fi
done

# One git grep pass; prints matches; returns 0 on matches, 1 when clean, 2+ on error.
grep_pass() {
  local mode=$1 pattern=$2
  shift 2
  git grep ${mode:+"$mode"} -a -n -i -E -e "$pattern" -- "$@" "${EXCLUDES[@]}"
}

# Prints matches; returns 0 when clean, 1 when there are matches, 2 on any git grep error.
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
out_source=$(scan "$SOURCE_PATTERN" src ${SOURCE_EXCLUDES[@]+"${SOURCE_EXCLUDES[@]}"} | sort -u) && source=0 || source=$?

if [ "$shipped" -eq 2 ] || [ "$source" -eq 2 ]; then exit 2; fi
hits=$(printf '%s\n' "$out_shipped" "$out_source" | sed '/^$/d')
if [ "${1:-}" = "--list" ] && [ -n "$hits" ]; then
  printf '%s\n' "$hits" | cut -c1-240
fi
if [ "$shipped" -ne 0 ] || [ "$source" -ne 0 ]; then
  if [ "${1:-}" != "--list" ]; then
    printf '%s\n' "$hits" | cut -d: -f1 | sort | uniq -c | sort -rn
  fi
  echo "FAIL: $(printf '%s\n' "$hits" | wc -l | tr -d ' ') phone-home / upsell reference(s) (run with --list for each one)"
  exit 1
fi
echo "OK: no phone-home or upsell references in ${#SHIPPED[@]} shipped paths, and no vendor endpoint in src/"
