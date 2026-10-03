#!/usr/bin/env bash
# Run before every push: secret/privacy scan, lint, typecheck, build.
# Extra private patterns (one regex per line) go in .private-patterns, which git ignores.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4 secrets and private info"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  files=$(git ls-files -co --exclude-standard | grep -v -E '^(package-lock\.json|public/)' || true)
else
  files=$(find . -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.git/*' -not -name package-lock.json)
fi

pattern='sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|[A-Za-z0-9._%+-]+@(gmail|hotmail|yahoo|outlook|icloud)\.com'
if [[ -f .private-patterns ]]; then
  extra=$(grep -v -E '^\s*(#|$)' .private-patterns | paste -sd'|' - || true)
  [[ -n "$extra" ]] && pattern="$pattern|$extra"
fi

found=0
if [[ -n "$files" ]]; then
  # shellcheck disable=SC2086
  if grep -n -I -i -E "$pattern" $files; then found=1; fi
  if echo "$files" | grep -E '(^|/)\.env' | grep -v -E '(^|/)\.env\.example$'; then
    echo "An .env file would be committed. It must stay ignored."
    found=1
  fi
fi
if [[ $found -ne 0 ]]; then
  echo "Fix the lines above before pushing."
  exit 1
fi
echo "clean"

echo "== 2/4 lint"
npm run lint

echo "== 3/4 typecheck"
npm run typecheck

echo "== 4/4 build"
npm run build

echo "All checks passed."
