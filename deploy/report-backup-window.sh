#!/usr/bin/env bash
# Fully copy state; worker quiescence/resumption requires explicit authorization.
set -euo pipefail
umask 077
[ "$#" = 5 ] || [ "$#" = 6 ] || { echo 'BACKUP_WINDOW_ARGUMENTS_INVALID' >&2; exit 2; }
quiesce=false
if [ "$#" = 6 ]; then
  [ "$6" = --quiesce-worker ] || { echo 'BACKUP_WINDOW_ARGUMENTS_INVALID' >&2; exit 2; }
  quiesce=true
fi
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

# sudo maintenance must not fetch/write Git as root in an operator-owned repo.
repo_git() {
  if [ "$(id -u)" = 0 ]; then
    owner_uid=$(stat -c %u -- "$repo") || return 1
    if [ "$owner_uid" != 0 ]; then
      [ "$(stat -c %u -- "$repo/.git")" = "$owner_uid" ] || { echo BACKUP_REPO_OWNER_INVALID >&2; return 1; }
      owner_record=$(getent passwd "$owner_uid") || { echo BACKUP_REPO_OWNER_INVALID >&2; return 1; }
      IFS=: read -r owner_name unused resolved_uid unused_fields <<< "$owner_record"
      [ -n "$owner_name" ] && [ "$resolved_uid" = "$owner_uid" ] || { echo BACKUP_REPO_OWNER_INVALID >&2; return 1; }
      runuser -u "$owner_name" -- git -C "$repo" "$@"
      return $?
    fi
  fi
  git -C "$repo" "$@"
}

# A failed pre-window prepare has no runtime to resume. Never hide real windows.
if [ "$mode" = resume ]; then
  [ ! -L "$session" ] || { echo BACKUP_RUNTIME_RECORD_UNAVAILABLE >&2; exit 2; }
  # Written only by the failure trap before either runtime transition begins.
  # A dead guardian after declined admission has no stopped runtime to recover.
  if [ -d "$session" ] && [ -f "$session/not-entered" ] && [ ! -L "$session/not-entered" ] &&
     [ "$(cat "$session/not-entered")" = "$candidate:$run_id" ] &&
     [ ! -L "$session/guardian-ready" ] &&
     { [ ! -e "$session/guardian-ready" ] || [ -f "$session/guardian-ready" ]; } &&
     [ ! -e "$session/prepared" ] && [ ! -L "$session/prepared" ] &&
     [ ! -e "$session/worker-draining" ] && [ ! -L "$session/worker-draining" ] &&
     [ ! -e "$session/quiescent" ] && [ ! -L "$session/quiescent" ]; then
    echo BACKUP_WINDOW_NOT_ENTERED
    exit 0
  fi
  if [ -d "$base" ] && [ -r "$base" ] && [ -x "$base" ] &&
     { [ ! -e "$session" ] || [ -d "$session" ]; } &&
     [ ! -e "$session/guardian-ready" ] && [ ! -L "$session/guardian-ready" ] &&
     [ ! -e "$session/prepared" ] && [ ! -L "$session/prepared" ] &&
     [ ! -e "$session/worker-draining" ] && [ ! -L "$session/worker-draining" ] &&
     [ ! -e "$session/quiescent" ] && [ ! -L "$session/quiescent" ]; then
    echo BACKUP_WINDOW_NOT_ENTERED
    exit 0
  fi
fi

resume_healthy_server() {
  docker start "$server" >/dev/null || return 1
  for attempt in $(seq 1 60); do
    if [ "$(docker inspect --format '{{.State.Status}}' "$server")" = running ] &&
       [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$server")" = healthy ]; then
      return 0
    fi
    sleep 2
  done
  echo 'BACKUP_SERVER_NOT_HEALTHY' >&2
  return 1
}

# IDs, image digests and the shared volume must still describe the captured runtime.
runtime_matches() {
  maintenance_lock_owned_by "$guardian" || return 1
  [ "$server" = "$(docker compose --env-file .env.production ps --all --quiet server)" ] &&
  [ "$worker" = "$(docker compose --env-file .env.production --profile reports ps --all --quiet report-worker)" ] &&
  [ "$image" = "$(docker inspect --format '{{.Image}}' "$server")" ] || return 1
  case "$(docker inspect --format '{{.State.Status}}' "$server")" in running|exited) ;; *) return 1 ;; esac
  case "$(docker inspect --format '{{.State.Status}}' "$worker")" in running|exited) ;; *) return 1 ;; esac
  if [ -n "$worker_image" ]; then
    [ "$worker_image" = "$(docker inspect --format '{{.Image}}' "$worker")" ] || return 1
  fi
  [ "$volume" = "$(docker inspect --format "$volume_format" "$server")" ] &&
  [ "$volume" = "$(docker inspect --format "$volume_format" "$worker")" ]
}

resume_original_runtime() {
  runtime_matches || { echo BACKUP_RUNTIME_CHANGED >&2; return 1; }
  resume_healthy_server || return 1
  # The only worker-start authorization is the private captured record plus flag.
  if [ "$quiesce" = true ] && [ "$authorized_quiesce" = true ] && [ "$worker_was_running" = true ]; then
    runtime_matches || return 1
    if [ -f "$session/worker-draining" ] && [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = running ]; then
      # A TERM-pending process cannot be restored by docker start (a no-op).
      docker kill --signal TERM "$worker" >/dev/null || return 1
      for attempt in $(seq 1 60); do
        [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ] && break
        sleep 2
      done
      [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ] || { echo BACKUP_WORKER_DRAIN_PENDING >&2; return 1; }
    fi
    runtime_matches || return 1
    docker start "$worker" >/dev/null || { echo BACKUP_WORKER_RESTART_FAILED >&2; return 1; }
    [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = running ] || return 1
  fi
  rm -f "$session/quiescent" "$session/worker-draining"
}
volume_format='{{range .Mounts}}{{if eq .Destination "/app/packages/server/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}'

if [ "$mode" = prepare ]; then
  # Read-only permission admission before Docker or creating private artifacts.
  lock=/run/lock/aemr-maintenance.lock
  if [ -L "$lock" ] || { [ -e "$lock" ] && { [ ! -f "$lock" ] || [ ! -w "$lock" ]; }; } ||
     { [ ! -e "$lock" ] && [ ! -w /run/lock ]; }; then
    echo BACKUP_MAINTENANCE_PERMISSION_DENIED >&2
    exit 2
  fi
  [ ! -e "$session" ] || { echo 'BACKUP_TARGET_EXISTS' >&2; exit 2; }
  server=$(docker compose --env-file .env.production ps --status running --quiet server)
  worker=$(docker compose --env-file .env.production --profile reports ps --all --quiet report-worker)
  [[ "$server" =~ ^[a-f0-9]{64}$ ]] && [[ "$worker" =~ ^[a-f0-9]{64}$ ]]
  worker_state=$(docker inspect --format '{{.State.Status}}' "$worker")
  case "$worker_state" in exited) worker_was_running=false ;; running)
    [ "$quiesce" = true ] || { echo BACKUP_WORKER_NOT_QUIESCENT >&2; exit 2; }
    worker_was_running=true ;; *) echo BACKUP_WORKER_STATE_UNKNOWN >&2; exit 2 ;; esac
  authorized_quiesce=$quiesce
  worker_image=$(docker inspect --format '{{.Image}}' "$worker")
  [[ "$worker_image" =~ ^sha256:[a-f0-9]{64}$ ]]
  volume_format='{{range .Mounts}}{{if eq .Destination "/app/packages/server/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}'
  volume=$(docker inspect --format "$volume_format" "$server")
  case "$volume" in ''|*[!A-Za-z0-9_.-]*) exit 2 ;; esac
  [ "$volume" = "$(docker inspect --format "$volume_format" "$worker")" ] || { echo 'BACKUP_WORKER_VOLUME_MISMATCH' >&2; exit 2; }
  image=$(docker inspect --format '{{.Image}}' "$server")
  [[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
  repo_git fetch --quiet origin "$candidate"
  mkdir -p "$session"
  chmod 700 "$base" "$session"
  repo_git show "$candidate:deploy/stateful_backup.py" > "$session/stateful_backup.py"
  repo_git show "$candidate:deploy/maintenance-lock.sh" > "$session/maintenance-lock.sh"
  . "$session/maintenance-lock.sh"
  python3 - "$session/runtime.json" "$server" "$worker" "$volume" "$image" "$candidate" "$worker_image" "$worker_was_running" "$authorized_quiesce" <<'PY'
import json, sys
from pathlib import Path
x=dict(zip(('server','worker','volume','image','candidate','worker_image','worker_was_running','authorized_quiesce'),sys.argv[2:],strict=True))
for k in ('worker_was_running','authorized_quiesce'): x[k]=x[k]=='true'
Path(sys.argv[1]).write_text(json.dumps(x))
PY
  repo_git show "$candidate:deploy/report-backup-window.sh" > "$session/recovery-window.sh"
  stopped=false
  worker_stopped=false
  restore_on_failure() {
    result=$?
    trap - EXIT
    if [ "$result" -ne 0 ] && [ "$stopped" = false ] && [ "$worker_stopped" = false ]; then
      printf '%s:%s\n' "$candidate" "$run_id" > "$session/not-entered"
      rm -f "$session/quiescent"
    fi
    if [ "$result" -ne 0 ] && { [ "$stopped" = true ] || [ "$worker_stopped" = true ]; }; then
      resume_original_runtime || echo 'BACKUP_SERVER_RESTART_FAILED' >&2
    fi
    exit "$result"
  }
  trap restore_on_failure EXIT
  # Independent bounded recovery if the runner or SSH disappears mid-window.
  # A resumed server makes subsequent match-source fail closed.
  touch "$session/quiescent"
  nohup bash -c '
    . "$3/maintenance-lock.sh"
    [ ! -L /run/lock/aemr-maintenance.lock ] || exit 1
    exec 9>/run/lock/aemr-maintenance.lock
    flock -n 9 || exit 1
    echo "$$" > "$1/guardian-ready"
    deadline=$((SECONDS + 1800))
    while [ -f "$1/quiescent" ]; do
      if [ "$SECONDS" -ge "$deadline" ] || { [ ! -f "$1/prepared" ] && ! kill -0 "$9" 2>/dev/null; }; then
        # Keep exclusion and retry if Docker is temporarily unavailable.
        timeout 300s bash "$1/recovery-window.sh" resume "$4" "$5" "$6" "$7" ${8:+"$8"} >/dev/null
      fi
      sleep 2
    done
  ' watchdog "$session" "$server" "$session" "$candidate" "$run_id" "$repo" "$base" "$([ "$quiesce" = true ] && echo --quiesce-worker || true)" "$$" </dev/null >"$session/watchdog.log" 2>&1 &
  guardian=$!
  for attempt in $(seq 1 100); do
    [ -f "$session/guardian-ready" ] && maintenance_lock_owned_by "$guardian" && break
    kill -0 "$guardian" 2>/dev/null || { echo 'BACKUP_GUARDIAN_FAILED' >&2; exit 2; }
    sleep 0.1
  done
  maintenance_lock_owned_by "$guardian" || { echo 'BACKUP_GUARDIAN_NOT_READY' >&2; exit 2; }
  # Cheap attempt admission only: do not hash/compress mutable live state here.
  # The frozen writer enforces 1 GiB reserve; full independent restore stays required.
  runtime_matches || { echo BACKUP_RUNTIME_CHANGED >&2; exit 2; }
  [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = "$worker_state" ]
  docker run --rm --network none --read-only --user 0 \
    --mount "type=bind,src=$session,dst=/backups,readonly" \
    --entrypoint /opt/report-env/bin/python "$image" -B -c '
import shutil,sys
try:
    if shutil.disk_usage("/backups").free < 4*1024**3:
        print("BACKUP_SPACE_BUDGET_INSUFFICIENT",file=sys.stderr); sys.exit(2)
except OSError:
    print("BACKUP_SPACE_BUDGET_UNAVAILABLE",file=sys.stderr); sys.exit(2)
print("BACKUP_SPACE_BUDGET_ADMITTED")'

  runtime_matches || { echo BACKUP_RUNTIME_CHANGED >&2; exit 2; }
  [ -f "$session/quiescent" ]
  [ "$(docker inspect --format '{{.State.Status}}' "$server")" = running ]
  [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = "$worker_state" ]
  if [ "$worker_was_running" = true ]; then
    worker_stopped=true
    touch "$session/worker-draining"
    # TERM lets the sequential worker finish the current cycle; never force-kill.
    docker kill --signal TERM "$worker" >/dev/null
    for attempt in $(seq 1 450); do
      [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ] && break
      sleep 2
    done
    [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ] || { echo BACKUP_WORKER_DRAIN_TIMEOUT >&2; exit 2; }
    [ "$(docker inspect --format '{{.State.ExitCode}}' "$worker")" = 0 ] || { echo BACKUP_WORKER_NOT_GRACEFUL >&2; exit 2; }
  fi
  runtime_matches || { echo BACKUP_RUNTIME_CHANGED >&2; exit 2; }
  [ -f "$session/quiescent" ]
  [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ]
  stopped=true
  docker stop --time 75 "$server" >/dev/null
  [ "$(docker inspect --format '{{.State.Status}}' "$server")" = exited ]
  docker run --rm --network none --read-only --user 0 \
    --mount "type=volume,src=$volume,dst=/source,readonly" \
    --mount "type=bind,src=$session,dst=/backups" \
    --mount "type=bind,src=$session/stateful_backup.py,dst=/tool.py,readonly" \
    --entrypoint /opt/report-env/bin/python "$image" -B /tool.py create \
    --source /source --backup /backups/backup --compressed --compression-level 1 --reserve-bytes 1073741824
  # Outer archive ownership only; original file attributes remain in manifest/tar.
  docker run --rm --network none --read-only --user 0 \
    --mount "type=bind,src=$session,dst=/backups" \
    --entrypoint /opt/report-env/bin/python "$image" -B -c \
    'import os,sys; from pathlib import Path; root=Path("/backups/backup"); [os.chown(p,int(sys.argv[1]),int(sys.argv[2])) for p in [root,*root.iterdir()]]' "$(id -u)" "$(id -g)"
  [ -f "$session/quiescent" ]
  [ "$(docker inspect --format '{{.State.Status}}' "$server")" = exited ]
  [ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ]
  touch "$session/prepared"
  trap - EXIT
  echo 'FULL_BACKUP_CREATED_SERVER_QUIESCENT'
  exit 0
fi

record=$(python3 - "$session/runtime.json" "$candidate" "$quiesce" <<'PY'
import json, re, sys
from pathlib import Path
try:
    x=json.loads(Path(sys.argv[1]).read_text())
    assert x['candidate'] == sys.argv[2]
    assert all(re.fullmatch('[a-f0-9]{64}', x[k]) for k in ('server', 'worker'))
    assert re.fullmatch('[A-Za-z0-9_.-]+', x['volume'])
    assert re.fullmatch('sha256:[a-f0-9]{64}', x['image'])
    for k in ('worker_was_running','authorized_quiesce'): assert type(x.get(k,False)) is bool
    assert isinstance(x.get('worker_image',''),str)
    if x.get('worker_image'): assert re.fullmatch('sha256:[a-f0-9]{64}',x['worker_image'])
    if sys.argv[3]=='true': assert x.get('authorized_quiesce') is True and x.get('worker_image')
except (OSError, ValueError, TypeError, KeyError, AssertionError):
    print('BACKUP_RUNTIME_RECORD_UNAVAILABLE', file=sys.stderr)
    sys.exit(2)
print('\n'.join([*(x[k] for k in ('server','worker','volume','image')),x.get('worker_image',''),str(x.get('worker_was_running',False)).lower(),str(x.get('authorized_quiesce',False)).lower()]))
PY
)
mapfile -t fields <<< "$record"
server=${fields[0]}
worker=${fields[1]}
volume=${fields[2]}
image=${fields[3]}
worker_image=${fields[4]}
worker_was_running=${fields[5]}
authorized_quiesce=${fields[6]}
. "$session/maintenance-lock.sh"
guardian=$(cat "$session/guardian-ready")
maintenance_lock_owned_by "$guardian" || { echo BACKUP_GUARDIAN_UNAVAILABLE >&2; exit 2; }
if [ "$mode" = resume ]; then
  resume_original_runtime
  if [ "$quiesce" = true ] && [ "$worker_was_running" = true ]; then
    echo ORIGINAL_SERVER_HEALTHY_ORIGINAL_WORKER_RESUMED
  else
    echo ORIGINAL_SERVER_RESUMED_WORKER_UNCHANGED
  fi
  exit 0
fi
runtime_matches || { echo BACKUP_RUNTIME_CHANGED >&2; exit 2; }
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
runtime_matches || { echo BACKUP_RUNTIME_CHANGED >&2; exit 2; }
[ -f "$session/quiescent" ]
[ "$(docker inspect --format '{{.State.Status}}' "$server")" = exited ]
[ "$(docker inspect --format '{{.State.Status}}' "$worker")" = exited ]
