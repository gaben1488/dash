"""
server_phase2_deploy.py — деплой AEMR full stack на VPS.

Шаги:
  1) git clone gaben1488/dash на сервер (если нет) или git pull (если есть)
  2) checkout feature/svod-rebrand-ui
  3) генерируем .env.production из локального .env + новый AEMR_API_KEY
  4) копируем .env.production через SFTP
  5) копируем aemr.db через SFTP в /tmp/, затем в named volume
  6) docker compose up -d --build (первый билд ~5-10 минут)
  7) проверяем curl http://IP/ и /api/health

Использование:
  AEMR_SRV_USER=aemr python scripts/server_phase2_deploy.py
"""
import sys, os, paramiko, secrets, time, re
sys.stdout.reconfigure(encoding='utf-8')

HOST = '193.233.244.217'
USER = os.environ.get('AEMR_SRV_USER', 'aemr')
KEY  = os.path.expanduser('~/.ssh/id_ed25519')

REPO_URL = 'https://github.com/gaben1488/dash.git'
BRANCH   = 'feature/svod-rebrand-ui'
REMOTE_DIR = '/home/aemr/dash'

LOCAL_ENV = r'C:\Users\filat\dash\packages\server\.env'
LOCAL_DB  = r'C:\Users\filat\dash\packages\server\data\aemr.db'

# ---- ssh ----
print(f'>>> connecting {USER}@{HOST}')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, key_filename=KEY, timeout=15, allow_agent=False, look_for_keys=False)

def run(cmd, timeout=600, hide=False):
    if not hide:
        print(f'$ {cmd}')
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout, get_pty=True)
    output = []
    for line in iter(stdout.readline, ''):
        if not line: break
        if not hide:
            print(line.rstrip())
        output.append(line)
    ec = stdout.channel.recv_exit_status()
    return ec, ''.join(output)

# ============ STEP 1 — clone or pull ============
print('\n=== STEP 1 — git clone / pull ===')
ec, out = run(f'test -d {REMOTE_DIR}/.git && echo EXISTS || echo MISSING', hide=True)
if 'EXISTS' in out:
    print('repo exists, pulling...')
    run(f'cd {REMOTE_DIR} && git fetch --all --prune && git checkout {BRANCH} && git reset --hard origin/{BRANCH}')
else:
    print('repo missing, cloning...')
    run(f'git clone --branch {BRANCH} {REPO_URL} {REMOTE_DIR}')

# ============ STEP 2 — env.production ============
print('\n=== STEP 2 — .env.production ===')

def parse_env(path):
    """Простой парсер .env с поддержкой многострочных значений в кавычках."""
    result = {}
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    # match KEY="value" (multiline) or KEY=value
    pattern = re.compile(r'^([A-Z_][A-Z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|(.*))$', re.MULTILINE | re.DOTALL)
    for m in pattern.finditer(text):
        k = m.group(1)
        v = m.group(2) if m.group(2) is not None else m.group(3)
        result[k] = v.strip()
    return result

local_env = parse_env(LOCAL_ENV)
api_key = secrets.token_urlsafe(48)

env_lines = [
    '# AEMR production env — сгенерировано автоматически',
    f'# {time.strftime("%Y-%m-%d %H:%M:%S")}',
    '',
    'NODE_ENV=production',
    'HOST=0.0.0.0',
    'PORT=3000',
    'LOG_LEVEL=info',
    '',
    'SQLITE_PATH=/app/data/aemr.db',
    '',
    f'AEMR_API_KEY={api_key}',
    '',
    f'GOOGLE_SHEETS_SPREADSHEET_ID={local_env.get("GOOGLE_SHEETS_SPREADSHEET_ID","")}',
    f'GOOGLE_SERVICE_ACCOUNT_EMAIL={local_env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL","")}',
    f'GOOGLE_PRIVATE_KEY="{local_env.get("GOOGLE_PRIVATE_KEY","")}"',
    '',
    'DOMAIN=:80',
]
env_content = '\n'.join(env_lines) + '\n'

sftp = c.open_sftp()
remote_env = f'{REMOTE_DIR}/deploy/.env.production'
with sftp.open(remote_env, 'w') as f:
    f.write(env_content)
sftp.chmod(remote_env, 0o600)
print(f'uploaded {remote_env} ({len(env_content)} bytes)')
print(f'AEMR_API_KEY (save this!) = {api_key}')

# ============ STEP 3 — copy aemr.db ============
print('\n=== STEP 3 — копируем aemr.db ===')
db_size = os.path.getsize(LOCAL_DB)
print(f'local aemr.db size: {db_size/1024/1024:.1f} MB')
print('uploading via sftp...')
t0 = time.time()
sftp.put(LOCAL_DB, '/tmp/aemr.db.upload')
print(f'uploaded in {time.time()-t0:.1f}s')
sftp.close()

# ============ STEP 4 — docker build + up ============
print('\n=== STEP 4 — docker compose up (это займёт 5-15 минут)... ===')
run(f'cd {REMOTE_DIR}/deploy && docker compose --env-file .env.production up -d --build', timeout=1800)

# ============ STEP 5 — залить БД в volume ============
print('\n=== STEP 5 — заливаем aemr.db в server_data volume ===')
run(f'cd {REMOTE_DIR}/deploy && docker compose stop server')
# Используем имя volume = aemr_server_data (compose project=aemr + volume=server_data)
run('docker run --rm -v aemr_server_data:/data -v /tmp/aemr.db.upload:/in.db alpine '
    'sh -c "cp /in.db /data/aemr.db && chown 1000:1000 /data/aemr.db && ls -la /data/"')
run(f'cd {REMOTE_DIR}/deploy && docker compose start server')
run('rm -f /tmp/aemr.db.upload')

# ============ STEP 6 — проверка ============
print('\n=== STEP 6 — проверка ===')
print('ждём 15s пока server-контейнер прогреется...')
time.sleep(15)
run(f'cd {REMOTE_DIR}/deploy && docker compose ps')
run('curl -s -o /dev/null -w "GET /:        HTTP %{http_code} %{size_download}b\\n" --max-time 10 http://localhost/')
run('curl -s -o /dev/null -w "GET /api/health: HTTP %{http_code} %{size_download}b\\n" --max-time 10 http://localhost/api/health')

c.close()
print('\n>>> DONE')
print(f'>>> Открывай: http://{HOST}/')
print(f'>>> API key для /api/* (если включится auth): {api_key}')
