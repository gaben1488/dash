"""server_update.py — UPDATE-деплой AEMR на VPS после пуша в main.

В отличие от server_phase2_deploy.py НЕ ротирует AEMR_API_KEY и НЕ пересоздаёт
.env.production — берёт существующий (localStorage-bootstrap не ломается).
Шаги: git fetch + checkout main + reset --hard origin/main → docker compose up -d --build → health.

Использование: AEMR_SRV_USER=aemr python scripts/server_update.py
"""
import os
import sys

import paramiko

sys.stdout.reconfigure(encoding='utf-8')

HOST = os.environ.get('AEMR_SRV_HOST', '193.233.91.162')
USER = os.environ.get('AEMR_SRV_USER', 'aemr')
# Выделенный деплой-ключ, НЕ личный id_ed25519 (правило: личный ключ не для деплоя).
KEY = os.path.expanduser(os.environ.get('AEMR_SSH_KEY', '~/.ssh/aemr_deploy'))
REMOTE_DIR = '/home/aemr/dash'


def run_remote(client: paramiko.SSHClient, cmd: str, timeout: int = 1200) -> str:
    print(f'\n$ {cmd}')
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = stdout.read().decode('utf-8', 'replace')
    print(out[-4000:])
    err = stderr.read().decode('utf-8', 'replace')
    if err.strip():
        print('STDERR:', err[-1500:])
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        raise RuntimeError(f'remote command failed with exit {exit_code}: {cmd}')
    return out


def main() -> None:
    print(f'>>> connect {USER}@{HOST}')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            HOST,
            username=USER,
            key_filename=KEY,
            timeout=20,
            allow_agent=False,
            look_for_keys=False,
        )
        run_remote(
            client,
            f'cd {REMOTE_DIR} && git fetch origin && git checkout main '
            '&& git reset --hard origin/main && git log --oneline -1',
        )
        run_remote(
            client,
            f'cd {REMOTE_DIR}/deploy '
            '&& docker compose --env-file .env.production up -d --build',
        )
        run_remote(
            client,
            'sleep 6 && curl -fsS -m 10 http://127.0.0.1/api/health && echo',
        )
    finally:
        client.close()
    print('>>> done')


if __name__ == '__main__':
    main()
