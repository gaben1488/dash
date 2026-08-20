"""fix_server_env.py — пересоздаёт .env.production на сервере чисто, без мусора."""
import sys, os, paramiko, secrets, time
sys.stdout.reconfigure(encoding='utf-8')

HOST = '193.233.244.217'
USER = os.environ.get('AEMR_SRV_USER', 'aemr')
# Выделенный деплой-ключ, НЕ личный id_ed25519 (правило: личный ключ не для деплоя;
# шов 12 реестра швов 09.07.2026 — здесь он оставался последним).
KEY = os.path.expanduser(os.environ.get('AEMR_SSH_KEY', '~/.ssh/aemr_deploy'))

# Читаем локальный .env построчно — простой стейт-машинный парсер
LOCAL_ENV = r'C:\Users\filat\dash\packages\server\.env'
PICK_KEYS = {
    'GOOGLE_SHEETS_SPREADSHEET_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
}

def parse_env_lines(path):
    """Линейный парсер: ключ=значение, многострочные значения только в кавычках на одной строке (escape \\n)."""
    out = {}
    with open(path, 'r', encoding='utf-8') as f:
        in_quoted = False
        cur_key = None
        cur_val = []
        for line in f:
            if in_quoted:
                cur_val.append(line)
                if line.rstrip('\n').endswith('"') and not line.rstrip('\n').endswith('\\"'):
                    out[cur_key] = ''.join(cur_val).strip().strip('"')
                    in_quoted = False
                    cur_key = None
                    cur_val = []
                continue
            line_s = line.strip()
            if not line_s or line_s.startswith('#'):
                continue
            if '=' not in line_s:
                continue
            k, v = line_s.split('=', 1)
            k = k.strip()
            if not k.replace('_', '').isalnum():
                continue
            if v.startswith('"') and not (v.endswith('"') and len(v) > 1):
                in_quoted = True
                cur_key = k
                cur_val = [v[1:] + '\n']  # без открывающей кавычки
            else:
                out[k] = v.strip().strip('"')
    return {k: v for k, v in out.items() if k in PICK_KEYS}

local = parse_env_lines(LOCAL_ENV)
print('parsed keys:', list(local.keys()))
print('GOOGLE_PRIVATE_KEY len:', len(local.get('GOOGLE_PRIVATE_KEY', '')))

# Используем СУЩЕСТВУЮЩИЙ AEMR_API_KEY с сервера, не генерим новый
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, key_filename=KEY, timeout=15, allow_agent=False, look_for_keys=False)

# забираем существующий API key из .env.production
sftp = c.open_sftp()
existing_api_key = ''
with sftp.open('/home/aemr/dash/deploy/.env.production', 'r') as f:
    for line in f:
        if line.startswith('AEMR_API_KEY='):
            existing_api_key = line.split('=', 1)[1].strip()
            break
print('existing api key:', existing_api_key[:8], '...')

if not existing_api_key:
    existing_api_key = secrets.token_urlsafe(48)

env = f"""# AEMR production env (regenerated cleanly)
# {time.strftime('%Y-%m-%d %H:%M:%S')}

NODE_ENV=production
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info

SQLITE_PATH=/app/packages/server/data/aemr.db

AEMR_API_KEY={existing_api_key}

GOOGLE_SHEETS_SPREADSHEET_ID={local.get('GOOGLE_SHEETS_SPREADSHEET_ID','')}
GOOGLE_SERVICE_ACCOUNT_EMAIL={local.get('GOOGLE_SERVICE_ACCOUNT_EMAIL','')}
GOOGLE_PRIVATE_KEY="{local.get('GOOGLE_PRIVATE_KEY','')}"

DOMAIN=:80
"""

print(f'\nnew .env.production length: {len(env)} chars')
print('--- preview (без приватного ключа) ---')
for line in env.split('\n'):
    if 'PRIVATE_KEY' in line:
        print('GOOGLE_PRIVATE_KEY="..." (len=' + str(len(local.get('GOOGLE_PRIVATE_KEY',''))) + ')')
    else:
        print(line)

with sftp.open('/home/aemr/dash/deploy/.env.production', 'w') as f:
    f.write(env)
sftp.chmod('/home/aemr/dash/deploy/.env.production', 0o600)
sftp.close()

# Restart server
print('\n>>> docker compose down + up')
stdin, stdout, stderr = c.exec_command(
    'cd /home/aemr/dash/deploy && docker compose down && docker compose --env-file .env.production up -d',
    timeout=120, get_pty=True)
for line in iter(stdout.readline, ''):
    if not line: break
    print(line.rstrip())

c.close()
print('\n>>> DONE')
