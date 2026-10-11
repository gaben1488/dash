#!/usr/bin/env bash
# Quiesce and fully copy state; no worker start, migration or deployment here.
set -euo pipefail
umask 077
[ "$#" = 5 ] || { echo 'BACKUP_WINDOW_ARGUMENTS_INVALID' >&2; exit 2; }
mode=$1
candidate=$2
run_id=$3
repo=$4
base=$5
case "$candidate" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#candidate}" = 40 ]
case "$run_id" in *[!0-9]*|'') exit 2 ;; esac
case "$mode" in prepare|match-source|resume) ;; *) exit 2 ;; esac
case "$repo:$base" in /*:/*) ;; *) exit 2 ;; esac
repo=$(realpath -e "$repo")
base=$(realpath -m "$base")
case "$base/" in "$repo/"*) echo 'BACKUP_PATH_OVERLAP' >&2; exit 2 ;; esac
session="$base/worker-$run_id"
cd "$repo/deploy"

resume_healthy_server() {
  docker start "$server" >/dev/null || return 1
  for attempt in $(seq 1 60); do
    if [ "$(docker inspect --format '{{.State.Status}}' "$server")" = running ] &&
       [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$server")" = healthy ]; then
      rm -f "$session/quiescent"
      return 0
    fi
    sleep 2
  done
  echo 'BACKUP_SERVER_NOT_HEALTHY' >&2
  return 1
}

if [ "$mode" = prepare ]; then
  [ ! -e "$session" ] || { echo 'BACKUP_TARGET_EXISTS' >&2; exit 2; }
  server=$(docker compose --env-file .env.production ps --status running --quiet server)
  worker=$(docker compose --env-file .env.production --profile reports ps --all --quiet report-worker)
  [[ "$server" =~ ^[a-f0-9]{64}$ ]] && [[ "$worker" =~ ^[a-f0-9]{64}$ ]]
  [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ] || { echo 'BACKUP_WORKER_NOT_QUIESCENT' >&2; exit 2; }
  volume_format='{{range .Mounts}}{{if eq .Destination "/app/packages/server/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}'
  volume=$(docker inspect --format "$volume_format" "$server")
  case "$volume" in ''|*[!A-Za-z0-9_.-]*) exit 2 ;; esac
  [ "$volume" = "$(docker inspect --format "$volume_format" "$worker")" ] || { echo 'BACKUP_WORKER_VOLUME_MISMATCH' >&2; exit 2; }
  image=$(docker inspect --format '{{.Image}}' "$server")
  [[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
  git -C "$repo" fetch --quiet origin "$candidate"
  mkdir -p "$session"
  chmod 700 "$base" "$session"
  git -C "$repo" show "$candidate:deploy/stateful_backup.py" > "$session/stateful_backup.py"
  python3 - "$session/runtime.json" "$server" "$worker" "$volume" "$image" "$candidate" <<'PY'
import json, sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps(dict(zip(('server', 'worker', 'volume', 'image', 'candidate'), sys.argv[2:], strict=True))))
PY
  stopped=false
  restore_on_failure() {
    result=$?
    trap - EXIT
    if [ "$result" -ne 0 ] && [ "$stopped" = true ]; then
      resume_healthy_server || echo 'BACKUP_SERVER_RESTART_FAILED' >&2
    fi
    exit "$result"
  }
  trap restore_on_failure EXIT
  # Independent bounded recovery if the runner or SSH disappears mid-window.
  # A resumed server makes subsequent match-source fail closed.
  touch "$session/quiescent"
  nohup bash -c 'sleep 1800; if [ -f "$1/quiescent" ]; then docker start "$2" >/dev/null && rm -f "$1/quiescent"; fi' \
    watchdog "$session" "$server" </dev/null >"$session/watchdog.log" 2>&1 &
  stopped=true
  docker stop --time 75 "$server" >/dev/null
  [ "$(docker inspect --format '{{.State.Status}}' "$server")" = exited ]
  docker run --rm --network none --read-only --user 0 \
    --mount "type=volume,src=$volume,dst=/source,readonly" \
    --mount "type=bind,src=$session,dst=/backups" \
    --mount "type=bind,src=$session/stateful_backup.py,dst=/tool.py,readonly" \
    --entrypoint /opt/report-env/bin/python "$image" -B /tool.py create \
    --source /source --backup /backups/backup --compressed
  # Outer archive ownership only; original file attributes remain in manifest/tar.
  docker run --rm --network none --read-only --user 0 \
    --mount "type=bind,src=$session,dst=/backups" \
    --entrypoint /opt/report-env/bin/python "$image" -B -c \
    'import os,sys; from pathlib import Path; root=Path("/backups/backup"); [os.chown(p,int(sys.argv[1]),int(sys.argv[2])) for p in [root,*root.iterdir()]]' "$(id -u)" "$(id -g)"
  [ -f "$session/quiescent" ]
  [ "$(docker inspect --format '{{.State.Status}}' "$server")" = exited ]
  [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ]
  trap - EXIT
  echo 'FULL_BACKUP_CREATED_SERVER_QUIESCENT'
  exit 0
fi

record=$(python3 - "$session/runtime.json" "$candidate" <<'PY'
import json, re, sys
from pathlib import Path
try:
    x=json.loads(Path(sys.argv[1]).read_text())
    assert x['candidate'] == sys.argv[2]
    assert all(re.fullmatch('[a-f0-9]{64}', x[k]) for k in ('server', 'worker'))
    assert re.fullmatch('[A-Za-z0-9_.-]+', x['volume'])
    assert re.fullmatch('sha256:[a-f0-9]{64}', x['image'])
except (OSError, ValueError, TypeError, KeyError, AssertionError):
    print('BACKUP_RUNTIME_RECORD_UNAVAILABLE', file=sys.stderr)
    sys.exit(2)
print('\n'.join(x[k] for k in ('server', 'worker', 'volume', 'image')))
PY
)
mapfile -t fields <<< "$record"
server=${fields[0]}
worker=${fields[1]}
volume=${fields[2]}
image=${fields[3]}
if [ "$mode" = resume ]; then
  resume_healthy_server
  echo 'ORIGINAL_SERVER_RESUMED_WORKER_UNCHANGED'
  exit 0
fi
[ -f "$session/quiescent" ]
[ "$(docker inspect --format '{{.State.Status}}' "$server")" = exited ]
[ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ]
docker run --rm --network none --read-only --user 0 \
  --mount "type=volume,src=$volume,dst=/source,readonly" \
  --mount "type=bind,src=$session,dst=/backups,readonly" \
  --mount "type=bind,src=$session/stateful_backup.py,dst=/tool.py,readonly" \
  --entrypoint /opt/report-env/bin/python "$image" -B /tool.py match-source \
  --source /source --backup /backups/backup
# The watchdog may have fired during the full inventory/hash scan.
[ -f "$session/quiescent" ]
[ "$(docker inspect --format '{{.State.Status}}' "$server")" = exited ]
[ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ]
