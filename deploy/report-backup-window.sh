#!/usr/bin/env bash
# Fully copy state; worker quiescence/resumption requires explicit authorization.
set -euo pipefail
umask 077
[ "$#" = 5 ] || [ "$#" = 6 ] || [ "$#" = 7 ] || { echo 'BACKUP_WINDOW_ARGUMENTS_INVALID' >&2; exit 2; }
quiesce=false
release=false
if [ "$#" -ge 6 ]; then
  [ "$6" = --quiesce-worker ] || { echo 'BACKUP_WINDOW_ARGUMENTS_INVALID' >&2; exit 2; }
  quiesce=true
fi
if [ "$#" = 7 ]; then
  [ "$7" = --release-controller ] || { echo BACKUP_WINDOW_ARGUMENTS_INVALID >&2; exit 2; }
  release=true
  [ "$(id -u)" = 0 ] || { echo RELEASE_ROOT_REQUIRED >&2; exit 2; }
fi
mode=$1
candidate=$2
run_id=$3
repo=$4
base=$5
case "$candidate" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#candidate}" = 40 ]
case "$run_id" in *[!0-9]*|'') exit 2 ;; esac
case "$mode" in prepare|match-source|resume|request-plan|request-release|release-dispatch|request-resume|resume-release) ;; *) exit 2 ;; esac
case "$repo:$base" in /*:/*) ;; *) exit 2 ;; esac
repo=$(realpath -e "$repo")
base=$(realpath -m "$base")
case "$base/" in "$repo/"*) echo 'BACKUP_PATH_OVERLAP' >&2; exit 2 ;; esac
session="$base/worker-$run_id"
release_root=/var/lib/aemr/release-runtime
release_tools=/usr/local/libexec/aemr
if [ "$release" = true ]; then
  [ "$base" = /home/aemr/.dash-private-backups ] || { echo RELEASE_BACKUP_BASE_INVALID >&2; exit 2; }
fi
if [ "$mode" = request-plan ] || [ "$mode" = request-release ] || [ "$mode" = release-dispatch ] || [ "$mode" = request-resume ] || [ "$mode" = resume-release ]; then
  [ "$release" = true ] || { echo RELEASE_WINDOW_NOT_AUTHORIZED >&2; exit 2; }
fi
if [ "$mode" = request-resume ]; then
  window=$(python3 -I - "$base" "$session" <<'PYOPEN'
import os,stat,sys
from pathlib import Path
try:
 base,session=map(Path,sys.argv[1:])
 for path in (base,session):
  assert not any(p.is_symlink() for p in (path,*path.parents))
  if not path.exists():print('NO_OPEN_WINDOW');sys.exit(0)
  assert stat.S_ISDIR(path.lstat().st_mode)
 # Preflight may fail before prepare creates this run's session or migrates
 # the operator-owned backup base. With no session there is nothing to resume;
 # only an existing session requires trusting privileged window artifacts.
 for path in (base,session):
  value=path.lstat();assert stat.S_ISDIR(value.st_mode) and value.st_uid==0 and stat.S_IMODE(value.st_mode)==0o700
 for name in ('quiescent','prepared','runtime.json','guardian-ready','release-window.json','cancel-request.json'):
  path=session/name
  if not path.exists() and not path.is_symlink():continue
  value=path.lstat();assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and stat.S_IMODE(value.st_mode)==0o600
 print('OPEN' if (session/'quiescent').exists() else 'NO_OPEN_WINDOW')
except Exception:
 print('RELEASE_CANCEL_INVALID',file=sys.stderr);sys.exit(2)
PYOPEN
)
  if [ "$window" = NO_OPEN_WINDOW ]; then echo NO_OPEN_WINDOW; exit 0; fi
fi
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

# A reconstructed, never-started container is as quiescent as an exited one.
# Running-worker drain still requires a real clean exit; never use this there.
worker_is_quiescent() {
  case "$(docker inspect --format '{{.State.Status}}' "$worker")" in
    exited|created) return 0 ;; *) return 1 ;;
  esac
}

# IDs, image digests and the shared volume must still describe the captured runtime.
runtime_matches() {
  maintenance_lock_owned_by "$guardian" || return 1
  [ "$server" = "$(docker compose --env-file .env.production ps --all --quiet server)" ] &&
  [ "$worker" = "$(docker compose --env-file .env.production --profile reports ps --all --quiet report-worker)" ] &&
  [ "$image" = "$(docker inspect --format '{{.Image}}' "$server")" ] || return 1
  case "$(docker inspect --format '{{.State.Status}}' "$server")" in running|exited) ;; *) return 1 ;; esac
  case "$(docker inspect --format '{{.State.Status}}' "$worker")" in running|exited|created) ;; *) return 1 ;; esac
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

release_completion() {
  python3 -I - "$release_root" "$release_tools" "$candidate" <<'PYCOMPLETE'
import hashlib,json,re,sys
from pathlib import Path
try:
 root,tools=map(Path,sys.argv[1:3]);candidate=sys.argv[3];sys.path.insert(0,str(tools))
 import release_recovery as r
 for name in ('pending-release.json','release-recovery-progress.json'):
  path=root.parent/name
  assert not path.exists() and not path.is_symlink()
 path=root/'trial-plan.json'
 plan=r.validate_plan(json.loads(r.read_owned(path))) if path.exists() or path.is_symlink() else None
 expected=(hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest()
           if plan is not None and plan['release_sha']==candidate else None)
 completed=False
 for name in ('release-accepted.json','release-recovered.json'):
  path=root.parent/name
  if not path.exists() and not path.is_symlink():continue
  record=json.loads(r.read_owned(path))
  if name=='release-recovered.json':
   r.validate_completed(record);sha=record['release_sha']
  else:
   assert isinstance(record,dict) and set(record)=={'plan_sha256','acceptance'}
   assert isinstance(record['plan_sha256'],str) and re.fullmatch('[a-f0-9]{64}',record['plan_sha256'])
   r.validate_acceptance(record['acceptance']);sha=record['acceptance']['release_sha']
  if sha!=candidate:continue
  assert expected is not None and record['plan_sha256']==expected
  completed=True
 print('COMPLETED' if completed else 'PRE_ARM')
except Exception:
 print('RELEASE_COMPLETION_INVALID',file=sys.stderr);sys.exit(2)
PYCOMPLETE
}

recover_pending_release() {
  if [ -e /var/lib/aemr/pending-release.json ] || [ -L /var/lib/aemr/pending-release.json ] ||
     [ -e /var/lib/aemr/release-recovery-progress.json ] || [ -L /var/lib/aemr/release-recovery-progress.json ]; then
    timeout --signal=TERM --kill-after=10s 2100s /usr/bin/python3 -Es "$release_tools/release_recovery.py" recover > "$session/release-recovery.log" 2>&1 || return 2
  fi
}

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
  case "$worker_state" in exited|created) worker_was_running=false ;; running)
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
  python3 -I - "$session/runtime.json" "$server" "$worker" "$volume" "$image" "$candidate" "$worker_image" "$worker_was_running" "$authorized_quiesce" "$release" <<'PY'
import json, sys
from pathlib import Path
x=dict(zip(('server','worker','volume','image','candidate','worker_image','worker_was_running','authorized_quiesce','release_controller'),sys.argv[2:],strict=True))
for k in ('worker_was_running','authorized_quiesce','release_controller'): x[k]=x[k]=='true'
Path(sys.argv[1]).write_text(json.dumps(x))
PY
  repo_git show "$candidate:deploy/report-backup-window.sh" > "$session/recovery-window.sh"
  if [ "$release" = true ]; then
    for tool in release-controller.py release_recovery.py release_trial.py stateful_backup.py source_ci_gate.py; do
      source_path="deploy/$tool"
      [ "$tool" != source_ci_gate.py ] || source_path=.github/ci/source_ci_gate.py
      repo_git show "$candidate:$source_path" > "$session/$tool.release-source"
    done
    # Measured full36GB backup + two restores exceed the former30-minute
    # dispatch allowance. Release only: finite75min, retaining900s admission.
    python3 -I - "$session" "$release_tools" "$candidate" "$run_id" <<'PYRELEASE'
import hashlib,json,os,stat,sys,time
from pathlib import Path
try:
 s,t=map(Path,sys.argv[1:3]);sha,run=sys.argv[3:]
 assert os.geteuid()==0
 for path in (s,t):
  value=path.lstat();assert stat.S_ISDIR(value.st_mode) and value.st_uid==0 and not value.st_mode & 0o022
 pins={}
 for name in ('release-controller.py','release_recovery.py','release_trial.py','stateful_backup.py','source_ci_gate.py'):
  path=t/name
  with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
   value=os.fstat(f.fileno());assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and not value.st_mode & 0o022
   body=f.read(1024*1024+1);assert len(body)<=1024*1024
  actual=hashlib.sha256(body).hexdigest();assert actual==hashlib.sha256((s/(name+'.release-source')).read_bytes()).hexdigest()
  pins[name]=actual
 record={'format':'aemr-release-window-v1','candidate':sha,'run_id':run,'module_sha256':pins,
         'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'deadline_ns':time.monotonic_ns()+4500*10**9}
 with (s/'release-window.json').open('x') as f:json.dump(record,f,sort_keys=True);f.flush();os.fsync(f.fileno())
except Exception:
 print('RELEASE_MODULE_PINS_INVALID',file=sys.stderr);sys.exit(2)
PYRELEASE
  fi
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
    maintenance_lock_acquire || exit 1
    echo "$$" > "$1/guardian-ready"
    deadline=$((SECONDS + 1800))
    [ "${10}" != true ] || deadline=$((SECONDS + 4500))
    while [ -f "$1/quiescent" ]; do
      if [ "${10}" = true ] && { [ -e "$1/cancel-request.json" ] || [ -L "$1/cancel-request.json" ]; }; then
        bash "$1/recovery-window.sh" resume-release "$4" "$5" "$6" "$7" --quiesce-worker --release-controller >/dev/null
        [ ! -f "$1/quiescent" ] && break
        if [ -e /var/lib/aemr/pending-release.json ] || [ -L /var/lib/aemr/pending-release.json ] ||
           [ -e /var/lib/aemr/release-recovery-progress.json ] || [ -L /var/lib/aemr/release-recovery-progress.json ]; then exit 2; fi
        sleep 2
        continue
      fi
      if [ "${10}" = true ] && [ -e /var/lib/aemr/release-runtime/guardian-request.json ]; then
        # Internal dispatcher verifies fd9 and pins; no path/command comes from receipt.
        bash "$1/recovery-window.sh" release-dispatch "$4" "$5" "$6" "$7" --quiesce-worker --release-controller >/dev/null
        [ ! -f "$1/quiescent" ] && break
        if [ -e /var/lib/aemr/pending-release.json ] || [ -L /var/lib/aemr/pending-release.json ] ||
           [ -e /var/lib/aemr/release-recovery-progress.json ] || [ -L /var/lib/aemr/release-recovery-progress.json ]; then
          # Do not imprison pending recovery behind an expired guardian lock.
          exit 2
        fi
      fi
      if [ "$SECONDS" -ge "$deadline" ] || { [ ! -f "$1/prepared" ] && ! kill -0 "$9" 2>/dev/null; }; then
        # Keep exclusion and retry if Docker is temporarily unavailable.
        timeout 300s bash "$1/recovery-window.sh" resume "$4" "$5" "$6" "$7" ${8:+"$8"} $([ "${10}" = true ] && echo --release-controller || true) >/dev/null
      fi
      sleep 2
    done
  ' watchdog "$session" "$server" "$session" "$candidate" "$run_id" "$repo" "$base" "$([ "$quiesce" = true ] && echo --quiesce-worker || true)" "$$" "$release" </dev/null >"$session/watchdog.log" 2>&1 &
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
  worker_is_quiescent
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
  worker_is_quiescent
  touch "$session/prepared"
  trap - EXIT
  echo 'FULL_BACKUP_CREATED_SERVER_QUIESCENT'
  exit 0
fi

record=$(python3 -I - "$session/runtime.json" "$candidate" "$quiesce" "$release" <<'PY'
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
    assert type(x.get('release_controller',False)) is bool and x.get('release_controller',False)==(sys.argv[4]=='true')
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
if [ "$mode" = request-plan ] || [ "$mode" = request-release ] || [ "$mode" = release-dispatch ] || [ "$mode" = request-resume ] || [ "$mode" = resume-release ]; then
  [ -f "$session/quiescent" ] || { echo RELEASE_WINDOW_NOT_PREPARED >&2; exit 2; }
  if [ "$mode" != request-resume ] && [ "$mode" != resume-release ]; then
    [ -f "$session/prepared" ] || { echo RELEASE_WINDOW_NOT_PREPARED >&2; exit 2; }
    [ ! -e "$session/cancel-request.json" ] && [ ! -L "$session/cancel-request.json" ] || { echo RELEASE_CANCEL_PENDING >&2; exit 2; }
  fi
  if [ "$mode" = release-dispatch ] || [ "$mode" = resume-release ]; then
    maintenance_lock_owned_by $$ || { echo RELEASE_SAME_OWNER_REQUIRED >&2; exit 2; }
  fi
  python3 -I - "$mode" "$session" "$release_root" "$release_tools" "$candidate" "$run_id" <<'PYHANDOFF'
import hashlib,json,os,re,stat,sys,time,uuid
from pathlib import Path
mode,session,root,tools,sha,run=sys.argv[1:];session,root,tools=map(Path,(session,root,tools))
def read(path):
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
  value=os.fstat(f.fileno());assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and not value.st_mode & 0o077 and value.st_size<=1024*1024
  return f.read()
def atomic(path,value):
 temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
 with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as f:
  json.dump(value,f,sort_keys=True);f.flush();os.fsync(f.fileno())
 os.replace(temporary,path)
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
try:
 assert os.geteuid()==0
 assert not any(path.is_symlink() for path in (tools,*tools.parents,root,*root.parents,session,*session.parents))
 value=tools.lstat();assert stat.S_ISDIR(value.st_mode) and value.st_uid==0 and not value.st_mode & 0o022
 cancelling=mode in {'request-resume','resume-release'}
 for directory in ((root.parent,session) if cancelling else (root.parent,root,session)):
  value=directory.lstat();assert stat.S_ISDIR(value.st_mode) and value.st_uid==0 and stat.S_IMODE(value.st_mode)==0o700
 window=json.loads(read(session/'release-window.json'))
 assert set(window)=={'format','candidate','run_id','module_sha256','boot_id','deadline_ns'}
 assert window['format']=='aemr-release-window-v1' and window['candidate']==sha and window['run_id']==run
 assert window['boot_id']==Path('/proc/sys/kernel/random/boot_id').read_text().strip()
 assert type(window['deadline_ns']) is int
 remaining=(window['deadline_ns']-time.monotonic_ns())//10**9
 assert cancelling or remaining>=900
 names={'release-controller.py','release_recovery.py','release_trial.py','stateful_backup.py','source_ci_gate.py'}
 assert isinstance(window['module_sha256'],dict) and set(window['module_sha256'])==names
 for name,expected in window['module_sha256'].items():
  assert isinstance(expected,str) and re.fullmatch('[a-f0-9]{64}',expected)
  path=tools/name
  with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
   value=os.fstat(f.fileno());assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and not value.st_mode & 0o022 and value.st_size<=1024*1024
   assert hashlib.sha256(f.read()).hexdigest()==expected
 if cancelling:
  captured=read(session/'runtime.json')
  assert json.loads(captured)['candidate']==sha
  for name in ('quiescent','guardian-ready'):read(session/name)
  request={'candidate':sha,'run_id':run,'runtime_sha256':hashlib.sha256(captured).hexdigest()}
  path=session/'cancel-request.json'
  if path.exists() or path.is_symlink():assert json.loads(read(path))==request
  elif mode=='request-resume':atomic(path,request)
  else:raise ValueError('missing cancellation')
  print('RELEASE_RESUME_REQUEST_QUEUED' if mode=='request-resume' else 'RELEASE_CANCEL_ADMITTED')
  sys.exit(0)
 if mode=='release-dispatch':
  stage=json.loads(read(root/'guardian-request.json')).get('stage')
 else:stage='prepare' if mode=='request-plan' else 'deploy'
 assert stage in {'prepare','deploy'}
 plan=json.loads(read(root/('base-plan.json' if stage=='prepare' else 'trial-plan.json')))
 assert plan['release_sha']==sha and plan['backup_reference']=='worker-'+run+'/backup'
 captured=json.loads(read(session/'runtime.json'))
 assert captured['candidate']==sha and plan['volume']==captured['volume']
 assert plan['images']['server']==captured['image'] and plan['images']['report-worker']==captured['worker_image']
 assert type(plan['original_running']['server']) is bool and plan['original_running']['server'] is True
 assert type(plan['original_running']['report-worker']) is bool and plan['original_running']['report-worker']==captured['worker_was_running']

 plan_sha=hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 request={'candidate':sha,'run_id':run,'plan_sha256':plan_sha,'stage':stage}
 if mode in {'request-plan','request-release'}:
  assert not (root/'guardian-request.json').exists() and not (root/'guardian-request.json').is_symlink()
  atomic(root/'guardian-request.json',request)
 else:
  assert json.loads(read(root/'guardian-request.json'))==request
  atomic(session/'release-dispatch.json',{'request':request,'remaining_seconds':int(remaining),'stage':stage})
except Exception:
 print('RELEASE_HANDOFF_INVALID',file=sys.stderr);sys.exit(2)
PYHANDOFF
  if [ "$mode" = request-resume ]; then exit 0; fi
  if [ "$mode" = request-plan ] || [ "$mode" = request-release ]; then
    echo RELEASE_REQUEST_QUEUED
    exit 0
  fi
  if [ "$mode" = resume-release ]; then
    recover_pending_release || exit 2
    completed=$(release_completion)
    if [ "$completed" = PRE_ARM ]; then resume_original_runtime
    else rm -f "$session/quiescent" "$session/worker-draining"; fi
    rm -f "$session/cancel-request.json" "$release_root/guardian-request.json"
    echo RELEASE_RESUME_COMPLETED
    exit 0
  fi
  # Only this inherited-fd9 child may transition runtime. CLI descendants retain EX.
  set +e
  remaining=$(python3 -I - "$session/release-dispatch.json" <<'PYREMAIN'
import json,sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text())['remaining_seconds'])
PYREMAIN
)
  stage=$(python3 -I - "$session/release-dispatch.json" <<'PYSTAGE'
import json,sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text())['stage'])
PYSTAGE
)
  if [ "$stage" = prepare ]; then
    timeout --signal=TERM --kill-after=10s "${remaining}s" /usr/bin/python3 -Es "$release_tools/release-controller.py" prepare \
      < "$release_root/base-plan.json" > "$session/release-prepare.log" 2>&1
    outcome=$?
    if [ "$outcome" -eq 0 ]; then
      python3 -I - "$release_root" "$release_tools" "$session" <<'PYPREPARED'
import hashlib,json,sys
from pathlib import Path
try:
 root,tools,session=map(Path,sys.argv[1:]);sys.path.insert(0,str(tools))
 import release_recovery as r
 request=json.loads(r.read_owned(root/'guardian-request.json'))
 plan=r.validate_plan(json.loads(r.read_owned(root/'trial-plan.json')))
 actual=hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 assert actual==request['plan_sha256'] and request['stage']=='prepare'
 r.atomic_json(session/'plan-prepared.json',request)
except Exception:
 print('RELEASE_PREPARED_PLAN_INVALID',file=sys.stderr);sys.exit(2)
PYPREPARED
      outcome=$?
    fi
    set -e
    rm -f "$release_root/guardian-request.json"
    if [ "$outcome" -ne 0 ]; then
      resume_original_runtime
      exit "$outcome"
    fi
    echo RELEASE_PLAN_PREPARED
    exit 0
  fi
  [ "$stage" = deploy ] || exit 2
  timeout --signal=TERM --kill-after=10s "${remaining}s" /usr/bin/python3 -Es "$release_tools/release-controller.py" deploy > "$session/release-controller.log" 2>&1
  outcome=$?
  set -e
  recover_pending_release || exit 2
  # Verify matching durable completion before ending custody. If no completion,
  # deploy rejected before arm and only captured original IDs may be resumed.
  completed=$(release_completion)
  if [ "$completed" = PRE_ARM ]; then
    resume_original_runtime
  else
    rm -f "$session/quiescent" "$session/worker-draining"
  fi
  rm -f "$release_root/guardian-request.json"
  printf '%s\n' "$outcome" > "$session/release-result"
  echo RELEASE_HANDOFF_COMPLETED
  exit "$outcome"
fi
if [ "$mode" = resume ]; then
  if [ "$release" = true ]; then
    maintenance_lock_owned_by $$ || { echo RELEASE_SAME_OWNER_REQUIRED >&2; exit 2; }
    [ ! -e /var/lib/aemr/pending-release.json ] && [ ! -L /var/lib/aemr/pending-release.json ] &&
    [ ! -e /var/lib/aemr/release-recovery-progress.json ] && [ ! -L /var/lib/aemr/release-recovery-progress.json ] || { echo RELEASE_RECOVERY_REQUIRED >&2; exit 2; }
  fi
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
worker_is_quiescent
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
worker_is_quiescent
