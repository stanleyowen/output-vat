#!/usr/bin/env bash
# Nightly pull-based auto-deploy for every GitHub-backed Docker app on the home server.
# GitHub can't reach the server, but the server can reach GitHub, so cron runs this once a day.
#
# The apps are listed in $AUTODEPLOY_CONF (default ~/server/autodeploy/apps.conf), one per line
# (format: deploy/autodeploy-apps.conf.example). For each app whose watched paths changed on its branch:
#   1. If it has a test command: build the Dockerfile's `test` stage and run it with no network.
#      If that fails, the running version stays and this commit is skipped.
#   2. Tag the current images :previous, update the code, then `docker compose up -d --build`.
#   3. Wait until every container in the compose project is healthy. If one isn't, put back the old
#      code and images.
# One app failing never stops the others. .env files, data/ and other server-only files are never touched.
#
# Usage: server-autodeploy.sh              deploy every app that changed
#        server-autodeploy.sh <app>...     only these apps
#        server-autodeploy.sh --status     what is deployed now and what the last run did
set -uo pipefail
# 022, not 077: files extracted from git must stay readable by the non-root users inside the images.
umask 022

ROOT="${AUTODEPLOY_ROOT:-$HOME/server/autodeploy}"
CONF="${AUTODEPLOY_CONF:-$ROOT/apps.conf}"
STATE="$ROOT/state"   # <app>.deployed  <app>.failed  <app>.result
SRCS="$ROOT/src"      # bare clones for mode=sync apps
HISTORY="$ROOT/history.log"
mkdir -p "$STATE" "$SRCS"; chmod 700 "$ROOT"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
note() { # app result  -> state file + history (history only for real events)
  printf '%s %s\n' "$(date '+%F %H:%M')" "$2" > "$STATE/$1.result"
  case "$2" in "up to date"*|"no deployable changes"*) ;; *) printf '%s %-14s %s\n' "$(date '+%F %T')" "$1" "$2" >> "$HISTORY" ;; esac
}

# ---- config ----------------------------------------------------------------------------------------
# Keys: name mode(sync|inplace) repo branch dir src paths watch profiles keep self test
# `test=` must come last: everything after it is the shell command run inside the test image.
parse() {
  A_name='' A_mode=sync A_repo='' A_branch=main A_dir='' A_src=. A_paths='' A_watch=''
  A_profiles='' A_keep='' A_self='' A_test=''
  local line="$1" kv
  if [[ "$line" == *" test="* ]]; then A_test="${line#* test=}"; line="${line%% test=*}"; fi
  for kv in $line; do
    case "$kv" in
      name=*|mode=*|repo=*|branch=*|dir=*|src=*|paths=*|watch=*|profiles=*|keep=*|self=*)
        printf -v "A_${kv%%=*}" '%s' "${kv#*=}" ;;
      *) echo "unknown setting '$kv'"; return 1 ;;
    esac
  done
  A_dir="${A_dir/#\~/$HOME}"
  [ -n "$A_name" ] && [ -n "$A_dir" ] || { echo "name= and dir= are required"; return 1; }
  [ "$A_mode" = inplace ] || [ -n "$A_repo" ] || { echo "repo= is required for mode=sync"; return 1; }
  CARGS=(); local p; for p in ${A_profiles//,/ }; do CARGS+=(--profile "$p"); done
}
apps() { grep -vE '^\s*(#|$)' "$CONF"; }
dc() { (cd "$A_dir" && docker compose "${CARGS[@]}" "$@"); }

# ---- helpers ---------------------------------------------------------------------------------------
compose_file() { local f; for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  [ -e "$1/$f" ] && { echo "$f"; return; }; done; }

built_images() { # image names of services that are built locally
  dc config --format json | python3 -c '
import json, sys
c = json.load(sys.stdin)
for n, s in c["services"].items():
    if "build" in s:
        print(s.get("image") or c["name"] + "-" + n)'
}
prev_tag() { local i="${1%@*}"; if [[ "${i##*/}" == *:* ]]; then echo "${i%:*}:previous"; else echo "$i:previous"; fi; }

# Prints nothing and returns 0 once every container of the project is healthy (or running, without a
# healthcheck) on two checks 10s apart; otherwise prints the bad state after 3 minutes.
wait_healthy() {
  local deadline=$((SECONDS + 180)) ok_once='' bad c st ids
  while :; do
    bad=''; ids="$(dc ps -a -q)"; [ -n "$ids" ] || bad='no containers'
    for c in $ids; do
      st="$(docker inspect -f '{{.Name}}={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c")"
      case "${st#*=}" in healthy|running) ;; *) bad="$st" ;; esac
    done
    if [ -z "$bad" ]; then [ -n "$ok_once" ] && return 0; ok_once=1; sleep 10; continue; fi
    ok_once=''
    (( SECONDS >= deadline )) && { echo "$bad"; return 1; }
    sleep 5
  done
}

# Build the tree that ends up in the compose dir for <commit>: the contents of <src>, or, when paths= is
# set, exactly those repo paths (from[:to]) and nothing else.
stage() { # clone commit out
  local tmp="$3.repo" item from to; rm -rf "$3" "$tmp"; mkdir -p "$3" "$tmp"
  git -C "$1" archive "$2" | tar -x -C "$tmp"
  if [ "$A_mode" = inplace ]; then cp -a "$tmp/$SUB/." "$3/"
  elif [ -n "$A_paths" ]; then
    for item in ${A_paths//,/ }; do
      from="${item%%:*}"; to="${item#*:}"
      [ -e "$tmp/$from" ] || { echo "path $from is not in the repo"; return 1; }
      mkdir -p "$(dirname "$3/$to")"; cp -a "$tmp/$from" "$3/$to"
    done
  else cp -a "$tmp/$A_src/." "$3/"; fi
  rm -rf "$tmp"
}
paths_from() { local item out=''; for item in ${A_paths//,/ }; do out+="${out:+,}${item%%:*}"; done; echo "$out"; }

snapshot() { # compose dir -> <out>, minus what sync_into never touches (for rollback)
  local k ex=(--exclude='.env*' --exclude=/data/)
  for k in ${A_keep//,/ }; do ex+=(--exclude="/$k"); done
  rsync -a "${ex[@]}" "$A_dir/" "$1/"
}

sync_into() { # staged-dir -> compose dir; never touches .env*, data/ or keep= paths
  local mode k filters=(--exclude=/.env --exclude=/data/ --filter='P .env*' --filter='P /data/')
  for k in ${A_keep//,/ }; do filters+=(--filter="P /$k"); done
  mode="$(stat -c %a "$A_dir")"
  rsync -a --delete "${filters[@]}" "$1/" "$A_dir/"
  chmod "$mode" "$A_dir"
}

# ---- one app ---------------------------------------------------------------------------------------
deploy_app() {
  local clone current target failed short work out compose img cause
  if [ "$A_mode" = inplace ]; then
    clone="$(git -C "$A_dir" rev-parse --show-toplevel)"
    SUB="$(realpath --relative-to="$clone" "$A_dir")"
    [ "$(git -C "$clone" symbolic-ref --short HEAD)" = "$A_branch" ] \
      || { note "$A_name" "FAILED: $clone is not on branch $A_branch"; return 1; }
    git -C "$clone" fetch --quiet origin "$A_branch"
    target="$(git -C "$clone" rev-parse "origin/$A_branch")"
    current="$(git -C "$clone" rev-parse HEAD)"
  else
    clone="$SRCS/$A_name.git"
    [ -d "$clone" ] || git clone --quiet --bare "$A_repo" "$clone"
    git -C "$clone" fetch --quiet origin "+refs/heads/$A_branch:refs/heads/$A_branch"
    target="$(git -C "$clone" rev-parse "refs/heads/$A_branch")"
    current="$(cat "$STATE/$A_name.deployed" 2>/dev/null || echo none)"
  fi
  short="${target:0:7}"
  if [ -z "$A_watch" ]; then
    if [ "$A_mode" = inplace ]; then A_watch="$SUB"; elif [ -n "$A_paths" ]; then A_watch="$(paths_from)"; else A_watch="$A_src"; fi
  fi

  if [ "$target" = "$current" ]; then echo "$target" > "$STATE/$A_name.deployed"; note "$A_name" "up to date at $short"; return 0; fi
  failed="$(cat "$STATE/$A_name.failed" 2>/dev/null || true)"
  if [ "$target" = "$failed" ]; then note "$A_name" "up to date: $short failed earlier, waiting for a new commit"; return 0; fi

  if [ "$current" != none ] && git -C "$clone" cat-file -e "$current^{commit}" 2>/dev/null \
     && git -C "$clone" diff --quiet "$current" "$target" -- ${A_watch//,/ }; then
    # Nothing under the watched paths changed (e.g. a client-only or docs commit).
    if [ "$A_mode" = inplace ] && ! git -C "$clone" merge --ff-only --quiet "$target"; then
      echo "$target" > "$STATE/$A_name.failed"; note "$A_name" "FAILED $short: local changes block a fast-forward"; return 1
    fi
    echo "$target" > "$STATE/$A_name.deployed"
    note "$A_name" "no deployable changes ${current:0:7}..$short"
    return 0
  fi

  log "$A_name: deploying $short (was ${current:0:7})"
  work="$(mktemp -d "$ROOT/.work.XXXXXX")"; out="$work/out.log"
  trap "rm -rf '$work'" EXIT   # deploy_app runs in its own subshell; expand now, locals are gone at exit
  stage "$clone" "$target" "$work/new"
  compose="$(compose_file "$A_dir")"
  if [ -z "$compose" ] || [ ! -e "$work/new/$compose" ]; then
    log "$A_name: $short has no ${compose:-compose file} in the deploy path — not deploying"
    echo "$target" > "$STATE/$A_name.failed"; note "$A_name" "FAILED $short: repo is missing ${compose:-a compose file}"; return 1
  fi

  # 1. Tests gate the deploy.
  if [ -n "$A_test" ]; then
    if ! docker build -q --target test -t "autodeploy-$A_name:test" "$work/new" >"$out" 2>&1 \
       || ! docker run --rm --network none "autodeploy-$A_name:test" sh -c "$A_test" >>"$out" 2>&1; then
      log "$A_name: tests FAILED for $short — keeping the running version"; tail -n 30 "$out"
      echo "$target" > "$STATE/$A_name.failed"; note "$A_name" "FAILED $short: tests failed, kept ${current:0:7}"; return 1
    fi
    log "$A_name: tests passed for $short"
  fi

  # 2. Deploy, keeping rollback images.
  local images=() i; mapfile -t images < <(built_images)
  for i in "${images[@]}"; do
    if docker image inspect "$i" >/dev/null 2>&1; then docker tag "$i" "$(prev_tag "$i")"; fi
  done
  if [ "$A_mode" = inplace ]; then
    git -C "$clone" merge --ff-only --quiet "$target" \
      || { echo "$target" > "$STATE/$A_name.failed"; note "$A_name" "FAILED $short: local changes block a fast-forward"; return 1; }
  else
    snapshot "$work/old"
    sync_into "$work/new"
  fi

  # 3. Build, start, health check — else roll back code and images.
  cause=''
  dc up -d --build >"$out" 2>&1 || cause="compose up failed: $(tail -n 3 "$out" | tr '\n' ' ')"
  if [ -z "$cause" ]; then cause="$(wait_healthy)" || true; fi
  if [ -n "$cause" ]; then
    log "$A_name: $short is not healthy ($cause) — rolling back to ${current:0:7}"
    for i in "${images[@]}"; do
      if docker image inspect "$(prev_tag "$i")" >/dev/null 2>&1; then docker tag "$(prev_tag "$i")" "$i"; fi
    done
    if [ "$A_mode" = inplace ]; then git -C "$clone" reset --quiet --keep "$current" || true
    else sync_into "$work/old" || true; fi
    # Rebuild from the restored files (cached layers make this quick); covers a missing :previous tag too.
    dc up -d --build >/dev/null 2>&1 || dc up -d --no-build >/dev/null 2>&1 || true
    echo "$target" > "$STATE/$A_name.failed"
    note "$A_name" "FAILED $short: $cause — rolled back to ${current:0:7}"; return 1
  fi

  echo "$target" > "$STATE/$A_name.deployed"; rm -f "$STATE/$A_name.failed"
  note "$A_name" "updated ${current:0:7} -> $short ($(git -C "$clone" log -1 --format=%s "$target" | cut -c1-70))"
  log "$A_name: deployed $short — healthy"
}

# Refresh the copy of this script that cron runs from the app that ships it (self=<path in repo>), but
# only when a newly deployed commit changed that file: the first sighting just records the commit, so
# a hand-installed newer copy is never downgraded. Swapped in by rename, so a running bash is unaffected.
self_update() {
  local clone ref seen new mark="$STATE/self.commit"; [ -n "$A_self" ] || return 0
  if [ "$A_mode" = inplace ]; then clone="$(git -C "$A_dir" rev-parse --show-toplevel)"; ref="$(git -C "$clone" rev-parse HEAD)"
  else clone="$SRCS/$A_name.git"; ref="$(cat "$STATE/$A_name.deployed" 2>/dev/null)" || return 0; fi
  seen="$(cat "$mark" 2>/dev/null || true)"
  if [ -z "$seen" ]; then echo "$ref" > "$mark"; return 0; fi
  [ "$seen" != "$ref" ] || return 0
  if git -C "$clone" diff --quiet "$seen" "$ref" -- "$A_self" 2>/dev/null; then echo "$ref" > "$mark"; return 0; fi
  new="$(mktemp "$ROOT/.self.XXXXXX")"
  if git -C "$clone" show "$ref:$A_self" > "$new" 2>/dev/null && bash -n "$new"; then
    chmod 700 "$new"; mv -f "$new" "$0"; echo "$ref" > "$mark"
    log "autodeploy script updated from $A_name@${ref:0:7}"
  else rm -f "$new"; log "autodeploy script at $A_name@${ref:0:7} is unreadable or invalid — keeping the current copy"; fi
}

status() {
  local line
  printf '%-14s %-8s %-9s %-s\n' APP MODE DEPLOYED "LAST RUN"
  while IFS= read -r line <&3; do
    parse "$line" || continue
    printf '%-14s %-8s %-9s %s\n' "$A_name" "$A_mode" "$(cut -c1-7 "$STATE/$A_name.deployed" 2>/dev/null || echo -)" \
      "$(cat "$STATE/$A_name.result" 2>/dev/null || echo 'never run')"
    dc ps --format '{{.Name}}  {{.Image}}  {{.Status}}' 2>/dev/null </dev/null | sed 's/^/    /'
  done 3< <(apps)
  echo; echo "Last 10 events ($HISTORY):"; tail -n 10 "$HISTORY" 2>/dev/null || echo "  none yet"
}

# ---- main ------------------------------------------------------------------------------------------
[ -r "$CONF" ] || { echo "no app list at $CONF"; exit 1; }
[ "${1:-}" = --status ] && { status; exit 0; }

exec 9>"$ROOT/.lock"
flock -n 9 || { log "another autodeploy run is active — skipping"; exit 0; }

rc=0 summary=()
while IFS= read -r line <&3; do
  if ! parse "$line"; then log "bad line in $CONF: $line"; rc=1; continue; fi
  if [ $# -gt 0 ] && [[ " $* " != *" $A_name "* ]]; then continue; fi
  if ! [ -d "$A_dir" ]; then log "$A_name: $A_dir does not exist"; note "$A_name" "FAILED: $A_dir missing"; rc=1; continue; fi
  rm -f "$STATE/$A_name.result"   # every handled outcome rewrites it
  # Not `( … ) || …`: bash ignores set -e inside a subshell on the left of || or in an if.
  ( set -e; deploy_app ) </dev/null; app_rc=$?
  if [ "$app_rc" -ne 0 ]; then
    rc=1
    [ -s "$STATE/$A_name.result" ] || { log "$A_name: unexpected error (exit $app_rc)"; note "$A_name" "FAILED: unexpected error, see autodeploy.log"; }
  fi
  summary+=("$A_name: $(cut -d' ' -f3- "$STATE/$A_name.result" 2>/dev/null)")
  self_update </dev/null
done 3< <(apps)

log "run finished"; printf '  %s\n' "${summary[@]}"
docker image prune -f >/dev/null 2>&1 || true
exit "$rc"
