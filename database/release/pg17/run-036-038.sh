#!/usr/bin/env bash
# Independent validation of the 036-038 bundle on a disposable PostgreSQL 17 server (embedded-postgres). Read-only with respect to
# every hosted database: no connection string is read. Usage: database/release/pg17/run-036-038.sh [work-dir]   (default: mktemp -d)
#   BASELINE   the released commit holding 001-035 (default origin/main)
#   CANDIDATE  the bundle commit (default HEAD)
set -euo pipefail
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORK="${1:-$(mktemp -d)}"
BASELINE="${BASELINE:-origin/main}"
CANDIDATE="${CANDIDATE:-HEAD}"
rm -rf "$WORK/t035" "$WORK/tcand"
mkdir -p "$WORK/t035" "$WORK/tcand" "$WORK/deps"
git -C "$REPO" archive "$BASELINE" | tar -x -C "$WORK/t035"
git -C "$REPO" archive "$CANDIDATE" | tar -x -C "$WORK/tcand"
# the verifier libraries import @electric-sql/pglite only through test helpers they do not load here; reuse the repo's modules
ln -sfn "$REPO/node_modules" "$WORK/t035/node_modules"
ln -sfn "$REPO/node_modules" "$WORK/tcand/node_modules"
[ -f "$WORK/deps/package.json" ] || ( cd "$WORK/deps" && npm init -y >/dev/null )
( cd "$WORK/deps" && npm i --no-audit --no-fund --silent embedded-postgres@17.9.0-beta.17 pg@8 )
echo "work dir: $WORK  baseline: $(git -C "$REPO" rev-parse --short "$BASELINE")  candidate: $(git -C "$REPO" rev-parse --short "$CANDIDATE")"
node "$REPO/database/release/pg17/validate-036-038.mjs" "$WORK"
