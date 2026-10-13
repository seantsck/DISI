#!/usr/bin/env bash
# Independent release validation on a disposable PostgreSQL 17 server (embedded-postgres). Read-only with respect to every
# hosted database: no connection string is read. Usage: database/release/pg17/run.sh [work-dir]   (default: a new mktemp dir)
set -euo pipefail
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORK="${1:-$(mktemp -d)}"
FROZEN_034=1edf314
CANDIDATE_035="${CANDIDATE_035:-HEAD}"
mkdir -p "$WORK/t034" "$WORK/t035" "$WORK/deps"
git -C "$REPO" archive "$FROZEN_034" | tar -x -C "$WORK/t034"
git -C "$REPO" archive "$CANDIDATE_035" | tar -x -C "$WORK/t035"
# the verifier libraries import @electric-sql/pglite only through test helpers they do not load here; reuse the repo's modules
ln -sfn "$REPO/node_modules" "$WORK/t034/node_modules"
ln -sfn "$REPO/node_modules" "$WORK/t035/node_modules"
[ -f "$WORK/deps/package.json" ] || ( cd "$WORK/deps" && npm init -y >/dev/null )
( cd "$WORK/deps" && npm i --no-audit --no-fund --silent embedded-postgres@17.9.0-beta.17 pg@8 )
echo "work dir: $WORK"
node "$REPO/database/release/pg17/validate-035.mjs" "$WORK"
node "$REPO/database/release/pg17/upgrade-034.mjs" "$WORK" "$REPO"
node "$REPO/database/release/pg17/expected-probe.mjs" "$WORK" "$REPO"
node "$REPO/database/release/pg17/restore-verify.mjs" "$WORK" --selftest
