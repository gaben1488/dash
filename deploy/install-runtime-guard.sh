#!/usr/bin/env bash
# Run from this checkout; optional argument is the production deploy directory.
set -euo pipefail
umask 077
. "$(dirname -- "$0")/maintenance-lock.sh"
maintenance_lock_acquire
deploy_dir=${1:-/home/aemr/dash/deploy}
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
install -d -m 700 /etc/aemr /etc/aemr/docker /var/lib/aemr
install -d -m 755 /usr/local/libexec/aemr
install -m 755 "$source_dir/runtime_guard.py" /usr/local/libexec/aemr/runtime_guard.py
install -m 644 "$source_dir/systemd/aemr-runtime-guard.service" /etc/systemd/system/
install -m 644 "$source_dir/systemd/aemr-runtime-guard.timer" /etc/systemd/system/
install -d -m 755 /etc/tmpfiles.d
install -m 644 "$source_dir/systemd/aemr-maintenance.conf" /etc/tmpfiles.d/
systemd-tmpfiles --create /etc/tmpfiles.d/aemr-maintenance.conf
python3 - "$source_dir/runtime-policy.json" "$deploy_dir" <<'PY'
import json,subprocess,sys
from pathlib import Path
policy=json.loads(Path(sys.argv[1]).read_text())
root=Path(sys.argv[2]).resolve(strict=True)
config=json.loads(subprocess.check_output(['docker','compose','--env-file',str(root/'.env.production'),
    '-f',str(root/'docker-compose.yml'),'--profile','reports','config','--format','json']))
for service,item in policy['services'].items():
    spec=config['services'][service]
    item['limits']={k:spec[k] for k in ('mem_limit','memswap_limit','mem_reservation','cpus','pids_limit','cpu_shares') if k in spec}
target=Path('/etc/aemr/runtime-policy.json')
temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(policy));temporary.chmod(0o600);temporary.replace(target)
PY
systemd-analyze verify /etc/systemd/system/aemr-runtime-guard.service /etc/systemd/system/aemr-runtime-guard.timer
systemctl daemon-reload
systemctl enable --now aemr-runtime-guard.service aemr-runtime-guard.timer
echo 'RUNTIME_GUARD_INSTALLED'
