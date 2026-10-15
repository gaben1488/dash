#!/usr/bin/env bash
# Run from this checkout; optional argument is the production deploy directory.
set -euo pipefail
umask 077
. "$(dirname -- "$0")/maintenance-lock.sh"
maintenance_lock_acquire 45
deploy_dir=${1:-/home/aemr/dash/deploy}
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# Never replace the executor/tool whose digests an armed release depends on.
for marker in /var/lib/aemr/pending-release.json /var/lib/aemr/release-recovery-progress.json; do
  if [ -e "$marker" ] || [ -L "$marker" ]; then echo RUNTIME_GUARD_RELEASE_PENDING >&2; exit 2; fi
done
# Installing reviewed programs never changes an existing operator approval.
# Validate it before ANY program replacement; malformed evidence fails closed.
policy_mode=$(python3 -I - /etc/aemr/runtime-policy.json <<'PYPOLICY'
import json,math,os,stat,sys
from pathlib import Path
try:
 path=Path(sys.argv[1])
 if not path.exists() and not path.is_symlink():print('NEW');sys.exit(0)
 assert not any(p.is_symlink() for p in (path,*path.parents))
 parent=path.parent.lstat()
 assert stat.S_ISDIR(parent.st_mode) and parent.st_uid==0 and not parent.st_mode & 0o022
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as file:
  value=os.fstat(file.fileno())
  assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and stat.S_IMODE(value.st_mode)==0o600 and value.st_size<=1024*1024
  policy=json.load(file)
 assert isinstance(policy,dict) and policy.get('project')=='aemr' and type(policy.get('worker_enabled')) is bool
 threshold=policy.get('failure_threshold',3);cooldown=policy.get('cooldown_seconds',300)
 assert type(threshold) is int and threshold>0
 assert type(cooldown) in (int,float) and math.isfinite(cooldown) and cooldown>=0
 services=policy.get('services')
 assert isinstance(services,dict) and set(services)=={'server','web','report-worker','caddy'}
 for service,item in services.items():
  assert isinstance(item,dict) and item.get('container')=='aemr-'+service+'-1'
  limits=item.get('limits',{})
  assert isinstance(limits,dict)
  for key in ('mem_limit','memswap_limit','mem_reservation','pids_limit','cpu_shares'):
   if key in limits:
    cap=limits[key]
    # Compose JSON encodes byte limits as decimal strings; preserve approved bytes.
    assert type(cap) is int or (type(cap) is str and cap==str(int(cap)))
    assert int(cap)>=(-1 if key in ('memswap_limit','pids_limit') else 0)
  if 'cpus' in limits:assert type(limits['cpus']) in (int,float,str) and math.isfinite(float(limits['cpus'])) and float(limits['cpus'])>=0
 print('PRESERVE')
except Exception:
 print('RUNTIME_GUARD_POLICY_INVALID',file=sys.stderr);sys.exit(2)
PYPOLICY
)
# Fixed host bindings are validated before changing installed programs or units.
python3 -I - <<'PYVOLUME'
import json,subprocess,sys
from pathlib import Path
try:
    x=json.loads(subprocess.check_output(['docker','volume','inspect','aemr_server_data'],stderr=subprocess.DEVNULL))[0]
    assert x['Name']=='aemr_server_data' and x['Driver']=='local' and not x.get('Options')
    assert (x.get('Labels') or {}).get('com.docker.compose.project')=='aemr'
    assert (x.get('Labels') or {}).get('com.docker.compose.volume')=='server_data'
    p=Path('/var/lib/docker/volumes/aemr_server_data/_data')
    assert x['Mountpoint']==str(p) and p.is_dir() and not any(v.is_symlink() for v in (p,*p.parents))
except (OSError,subprocess.CalledProcessError,KeyError,IndexError,TypeError,ValueError,AssertionError):
    print('RUNTIME_GUARD_VOLUME_INVALID',file=sys.stderr);sys.exit(2)
PYVOLUME
install -d -m 700 /etc/aemr /etc/aemr/docker /var/lib/aemr /var/lib/aemr/release-runtime
install -d -m 755 /usr/local/libexec/aemr
# Installed executor and backup helper must be the same reviewed source set.
install -m 755 "$source_dir/runtime_guard.py" /usr/local/libexec/aemr/runtime_guard.py
install -m 755 "$source_dir/release_recovery.py" /usr/local/libexec/aemr/release_recovery.py
install -m 755 "$source_dir/stateful_backup.py" /usr/local/libexec/aemr/stateful_backup.py
install -m 755 "$source_dir/release-controller.py" /usr/local/libexec/aemr/release-controller.py
install -m 755 "$source_dir/release_trial.py" /usr/local/libexec/aemr/release_trial.py
install -m 755 "$source_dir/../.github/ci/source_ci_gate.py" /usr/local/libexec/aemr/source_ci_gate.py
install -m 644 "$source_dir/docker-compose.yml" /usr/local/libexec/aemr/reviewed-docker-compose.yml
install -m 644 "$source_dir/Caddyfile" /usr/local/libexec/aemr/reviewed-Caddyfile
install -d -o root -g root -m 700 /home/aemr/.dash-private-backups
install -m 644 "$source_dir/systemd/aemr-runtime-guard.service" /etc/systemd/system/
install -m 644 "$source_dir/systemd/aemr-runtime-guard.timer" /etc/systemd/system/
install -d -m 755 /etc/tmpfiles.d
install -m 644 "$source_dir/systemd/aemr-maintenance.conf" /etc/tmpfiles.d/
systemd-tmpfiles --create /etc/tmpfiles.d/aemr-maintenance.conf
if [ "$policy_mode" = NEW ]; then
python3 -I - "$source_dir/runtime-policy.json" "$deploy_dir" <<'PY'
import json,os,subprocess,sys,tempfile
from pathlib import Path
policy=json.loads(Path(sys.argv[1]).read_text())
root=Path(sys.argv[2]).resolve(strict=True)
config=json.loads(subprocess.check_output(['docker','compose','--env-file',str(root/'.env.production'),
    '-f',str(root/'docker-compose.yml'),'--profile','reports','config','--format','json']))
for service,item in policy['services'].items():
    spec=config['services'][service]
    item['limits']={k:spec[k] for k in ('mem_limit','memswap_limit','mem_reservation','cpus','pids_limit','cpu_shares') if k in spec}
target=Path('/etc/aemr/runtime-policy.json')
temporary=None
try:
    with tempfile.NamedTemporaryFile(mode='w',dir=target.parent,prefix='.runtime-policy-',delete=False) as file:
        temporary=Path(file.name);json.dump(policy,file);file.flush();os.fsync(file.fileno())
    temporary.replace(target)
    fd=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
finally:
    if temporary is not None:temporary.unlink(missing_ok=True)
PY
fi
systemd-analyze verify /etc/systemd/system/aemr-runtime-guard.service /etc/systemd/system/aemr-runtime-guard.timer
systemctl daemon-reload
systemctl enable --now aemr-runtime-guard.service aemr-runtime-guard.timer
echo 'RUNTIME_GUARD_INSTALLED'
