"""server_check.py — sanity-check свежекупленного VPS перед настройкой."""
import sys, paramiko, os
sys.stdout.reconfigure(encoding='utf-8')

HOST = '193.233.244.217'
USER = 'root'
# password передаётся через env, а не в коде
PWD = os.environ.get('AEMR_SRV_PWD', '')
if not PWD:
    print('ERROR: set AEMR_SRV_PWD env var', file=sys.stderr); sys.exit(1)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PWD, timeout=15, allow_agent=False, look_for_keys=False)

cmds = [
    ('uname -a', 'kernel'),
    ('cat /etc/os-release | head -3', 'os'),
    ('lsb_release -a 2>/dev/null', 'lsb'),
    ('free -h', 'memory'),
    ('df -h /', 'disk'),
    ('nproc', 'cpu cores'),
    ('which docker; docker --version 2>/dev/null', 'docker'),
    ('which docker-compose; docker compose version 2>/dev/null', 'compose'),
    ('which git', 'git'),
    ('which curl', 'curl'),
    ('which ufw; ufw status 2>/dev/null', 'firewall'),
    ('cat /etc/timezone', 'tz'),
    ('id', 'identity'),
    ('locale | head -3', 'locale'),
]

for cmd, label in cmds:
    stdin, stdout, stderr = c.exec_command(cmd, timeout=10)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    print(f'\n[{label}] $ {cmd}')
    if out: print(out)
    if err: print('STDERR:', err)

c.close()
print('\n--- DONE ---')
