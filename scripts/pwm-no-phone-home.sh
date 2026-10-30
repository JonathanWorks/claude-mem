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
#   SHIPPED  the plugin, the hub, the integrations (git grep), and every file `npm pack` publishes
#            (README/LICENSE excepted: this fork does not publish to npm). No vendor host, telemetry
#            SDK, hosted-plan or upsell text.
#   SOURCE   src/ and scripts/, and the built dist/ files npm would publish (they keep unreachable
#            hosted-plan code paths, tracked for removal): no vendor endpoint of any shape.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$root"
command -v git >/dev/null || { echo "FAIL: git is required" >&2; exit 2; }
top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$top" ] || [ "$(cd "$top" && pwd -P)" != "$root" ]; then
  echo "FAIL: run from this repository's own git work tree (found '${top:-none}')" >&2
  exit 2
fi

# The shipped tier is EVERY tracked file except this explicit list of things that never ship
# (development notes, tests, the vendor's dev metadata, CI). A new top-level folder is scanned by
# default; it is never "safe because nobody listed it".
NOT_SHIPPED=(src scripts tests docs plans workers evals fixtures .maestro .plan .agent-jobs .claude .github
  CHANGELOG.md README.md SECURITY.md CLAUDE.md PWM-FORK.md WARP.md RECEIPT-JOIN.md bunfig.toml)
not_shipped_specs=()
for entry in "${NOT_SHIPPED[@]}"; do not_shipped_specs+=(":(exclude)$entry"); done
SHIPPED=(. "${not_shipped_specs[@]}")
command -v node >/dev/null || { echo "FAIL: node is required" >&2; exit 2; }
command -v npm >/dev/null || { echo "FAIL: npm is required" >&2; exit 2; }

SHIPPED_PATTERN='(cmem|claude-mem)\.ai|posthog|cmem[ -]?pro([^a-z0-9]|$)|cmem[ -]?cloud|teambrain|free trial|pro[-_ ]trial|PRO_TRIAL|buymeacoffee|patreon\.com|github:thedotmack|:[[:space:]]*"thedotmack/claude-mem|thedotmack\.github\.io|thedotmack/claude-mem\.git|(github|githubusercontent|codeload\.github)\.com/thedotmack|api\.github\.com/repos/thedotmack'
SOURCE_PATTERN='(cmem|claude-mem)\.ai|posthog|[a-z]+://[^[:space:]"'"'"'`]*thedotmack/claude-mem|/gh/thedotmack|thedotmack\.github\.io|github\.com[:/]thedotmack|githubusercontent\.com/thedotmack|repos/thedotmack|github:thedotmack|repo["'"'"'`]?[[:space:]]*:[[:space:]]*["'"'"'`]thedotmack/claude-mem'
# Not code that ships: npm lockfile funding metadata and upstream's changelog of past releases.
EXCLUDES=(':(exclude,glob)**/package-lock.json' ':(exclude)CHANGELOG.md')
SOURCE_EXCLUDES=()

for entry in src scripts; do
  if [ -z "$(git ls-files -- "$entry" | head -1)" ]; then
    echo "FAIL: scope entry '$entry' has no tracked file; update the guard" >&2
    exit 2
  fi
done

# A tracked symlink is scanned only as its link text, so shipped symlinks are an explicit allowlist,
# each pinned to its exact target text. Any other shipped symlink (or a changed target) fails: path
# resolution tricks (.., case, links to the root) cannot slip through what is never resolved.
ALLOWED_SYMLINKS=(
  "openclaw/skills/do/SKILL.md=../../../plugin/skills/do/SKILL.md"
  "openclaw/skills/make-plan/SKILL.md=../../../plugin/skills/make-plan/SKILL.md"
)
while IFS= read -r -d '' record; do
  case "$record" in 120000* | 160000*) ;; *) continue ;; esac
  link="${record#*$'\t'}"
  skip=0
  for entry in "${NOT_SHIPPED[@]}"; do
    case "$link" in "$entry" | "$entry"/*) skip=1 ;; esac
  done
  [ "$skip" = 1 ] && continue
  # git grep does not enter submodules, so a shipped submodule is never allowed.
  case "$record" in 160000*) echo "FAIL: shipped submodule is not scanned: $link" >&2; exit 2 ;; esac
  pair="$link=$(readlink "$link" 2>/dev/null || true)"
  allowed=0
  for ok in "${ALLOWED_SYMLINKS[@]}"; do [ "$pair" = "$ok" ] && allowed=1; done
  if [ "$allowed" != 1 ]; then
    echo "FAIL: shipped symlink is not on the guard's allowlist: $pair" >&2
    exit 2
  fi
done < <(git ls-files -s -z)

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
out_source=$(scan "$SOURCE_PATTERN" src scripts ':(exclude)scripts/pwm-no-phone-home.sh' ${SOURCE_EXCLUDES[@]+"${SOURCE_EXCLUDES[@]}"} | sort -u) && source=0 || source=$?

# What npm publishes is whatever `npm pack` says it is: the guard asks npm instead of re-deriving
# its file selection. Built dist/ files (compiled from src/ and scripts/) get the endpoint pattern;
# every other published file gets the full shipped pattern. Any npm or read failure fails closed.
if node -e 'const p=require("./package.json"); const has = (v) => Array.isArray(v) ? v.length > 0 : Boolean(v); process.exit(has(p.bundleDependencies) || has(p.bundledDependencies) || has(p.workspaces) ? 0 : 1)'; then
  echo "FAIL: package.json declares bundled dependencies or workspaces; the guard cannot see what they ship" >&2
  exit 2
fi
pack_json="$(npm pack --dry-run --json --ignore-scripts 2>/dev/null)" || { echo "FAIL: npm pack --dry-run failed" >&2; exit 2; }
out_pack=$(PACK_JSON="$pack_json" SHIPPED_RE="$SHIPPED_PATTERN" SOURCE_RE="$SOURCE_PATTERN" node -e '
const fs = require("fs");
let files;
try {
  const packs = JSON.parse(process.env.PACK_JSON);
  if (!Array.isArray(packs) || packs.length !== 1) process.exit(2);
  files = packs[0].files.map((f) => f.path);
} catch { process.exit(2); }
if (!files || files.length === 0) process.exit(2);
// grep -E bracket classes are not JavaScript: translate the one the patterns use.
const js = (re) => new RegExp(re.replace(/\[:space:\]/g, "\\s"), "i");
const shipped = js(process.env.SHIPPED_RE);
const source = js(process.env.SOURCE_RE);
let hit = false;
for (const f of files) {
  if (["package-lock.json", "CHANGELOG.md", "README.md", "LICENSE", "LICENSE.md", "LICENSE.txt"].includes(f)) continue;
  let text;
  try { text = fs.readFileSync(f, "latin1"); } catch { console.error("cannot read " + f); process.exit(2); }
  const re = f.startsWith("dist/") ? source : shipped;
  text.split(/\r?\n/).forEach((line, i) => { if (re.test(line)) { hit = true; console.log(f + ":" + (i + 1) + ":" + line.slice(0, 200)); } });
}
process.exit(hit ? 1 : 0);
' | sort -u) && packed=0 || packed=$?

if [ "$shipped" -eq 2 ] || [ "$source" -eq 2 ] || [ "$packed" -eq 2 ]; then exit 2; fi
hits=$(printf '%s\n' "$out_shipped" "$out_source" "$out_pack" | sed '/^$/d')
if [ "${1:-}" = "--list" ] && [ -n "$hits" ]; then
  printf '%s\n' "$hits" | cut -c1-240
fi
if [ "$shipped" -ne 0 ] || [ "$source" -ne 0 ] || [ "$packed" -ne 0 ]; then
  if [ "${1:-}" != "--list" ]; then
    printf '%s\n' "$hits" | cut -d: -f1 | sort | uniq -c | sort -rn
  fi
  echo "FAIL: $(printf '%s\n' "$hits" | wc -l | tr -d ' ') phone-home / upsell reference(s) (run with --list for each one)"
  exit 1
fi
echo "OK: no phone-home or upsell references in shipped files or the npm package, and no vendor endpoint in src/ or scripts/"
