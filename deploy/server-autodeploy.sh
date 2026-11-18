#!/usr/bin/env bash
# Pull-based auto-deploy for the API on the home server (GitHub can't reach it; it can reach GitHub).
# Run from cron (daily at 03:30 on the server). For each new commit on origin/main that changes server/:
#   1. build the test image and run the test suite   -> on failure: keep the running version, skip this commit
#   2. keep the current image as :previous, sync the code, rebuild and restart
#   3. wait for the container healthcheck            -> on failure: roll back to :previous
# .env and data/ in the app directory are never touched.
set -euo pipefail

SRC="${OVAT_SRC:-$HOME/server/output-vat-src}"   # dedicated clone of the repo (no local edits)
APP="${OVAT_APP:-$HOME/server/output-vat}"       # docker compose project: .env + data/ live here
STATE="$APP/.deployed-commit"
FAILED="$APP/.failed-commit"
REPO="https://github.com/stanleyowen/output-vat.git"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

[ -d "$SRC/.git" ] || git clone --quiet "$REPO" "$SRC"
cd "$SRC"
git fetch --quiet origin main
target="$(git rev-parse origin/main)"
current="$(cat "$STATE" 2>/dev/null || echo none)"

[ "$target" = "$current" ] && exit 0
[ "$target" = "$(cat "$FAILED" 2>/dev/null || true)" ] && exit 0  # already failed; wait for a new commit

if [ "$current" != none ] && git cat-file -e "$current^{commit}" 2>/dev/null && git diff --quiet "$current" "$target" -- server/; then
  echo "$target" > "$STATE"  # no server changes in this push (e.g. web-only)
  exit 0
fi

short="${target:0:7}"
log "deploying $short (was ${current:0:7})"
git checkout --quiet --force --detach "$target"

# 1. Tests gate the deploy.
docker build -q --target test -t output-vat-api:test "$SRC/server" >/dev/null
if ! docker run --rm --network none output-vat-api:test npm test >/tmp/ovat-autodeploy-test.log 2>&1; then
  log "tests FAILED for $short — keeping the running version"
  tail -n 30 /tmp/ovat-autodeploy-test.log
  echo "$target" > "$FAILED"
  exit 1
fi
log "tests passed for $short"

# 2. Deploy, keeping a rollback image.
if docker image inspect output-vat-api:latest >/dev/null 2>&1; then
  docker tag output-vat-api:latest output-vat-api:previous
fi
rsync -a --delete \
  --exclude data --exclude .env --exclude .acc \
  --exclude .deployed-commit --exclude .failed-commit \
  "$SRC/server/" "$APP/"
chmod 700 "$APP"
cd "$APP"
docker compose up -d --build api >/dev/null 2>&1

# 3. Health check, else roll back.
cid="$(docker compose ps -q api)"
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo unknown)"
  [ "$status" = healthy ] && break
  sleep 3
done
if [ "$status" != healthy ]; then
  log "new version $short is $status — rolling back"
  if docker image inspect output-vat-api:previous >/dev/null 2>&1; then
    docker tag output-vat-api:previous output-vat-api:latest
    docker compose up -d --no-build api >/dev/null 2>&1
  fi
  echo "$target" > "$FAILED"
  exit 1
fi

echo "$target" > "$STATE"
rm -f "$FAILED"
# Refresh the copy cron runs (never executed in place, so a running deploy isn't modified mid-run).
install -m 700 "$SRC/deploy/server-autodeploy.sh" "$HOME/server/output-vat-autodeploy.sh"
docker image prune -f >/dev/null 2>&1 || true
log "deployed $short — healthy"
