#!/usr/bin/env bash
# Independent validation of migration 046 (reviewed acquisition-cost research batch) on a disposable PostgreSQL 17 server (embedded-postgres).
# No hosted database is touched: no connection string is read. Usage: database/release/pg17/run-046.sh [work-dir]   (default: mktemp -d)
#   BASELINE   the released commit holding 001-045b (default origin/main)
#   CANDIDATE  the 046 commit (default HEAD)
set -euo pipefail
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORK="${1:-$(mktemp -d)}"
BASELINE="${BASELINE:-origin/main}"
CANDIDATE="${CANDIDATE:-HEAD}"
rm -rf "$WORK/tbase" "$WORK/tcand"
mkdir -p "$WORK/tbase" "$WORK/tcand" "$WORK/deps"
git -C "$REPO" archive "$BASELINE" | tar -x -C "$WORK/tbase"
git -C "$REPO" archive "$CANDIDATE" | tar -x -C "$WORK/tcand"
ln -sfn "$REPO/node_modules" "$WORK/tbase/node_modules"
ln -sfn "$REPO/node_modules" "$WORK/tcand/node_modules"
[ -f "$WORK/deps/package.json" ] || ( cd "$WORK/deps" && npm init -y >/dev/null )
( cd "$WORK/deps" && npm i --no-audit --no-fund --silent embedded-postgres@17.9.0-beta.17 pg@8 )
echo "work dir: $WORK  baseline: $(git -C "$REPO" rev-parse --short "$BASELINE")  candidate: $(git -C "$REPO" rev-parse --short "$CANDIDATE")"
node "$REPO/database/release/pg17/validate-046.mjs" "$WORK"
