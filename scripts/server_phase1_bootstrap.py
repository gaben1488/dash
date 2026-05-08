"""
server_phase1_bootstrap.py — первичная настройка свежекупленного VPS.
Делает:
  1) apt update + базовые утилиты
  2) timezone Asia/Kamchatka
  3) swap 2 GB
  4) ufw firewall (22, 80, 443)
  5) пользователь aemr c sudo, ssh-ключ копируется
  6) docker + docker compose
  7) hardening sshd: без root password, только ssh keys
  8) auto-updates безопасности
"""
import sys, paramiko, os, time
sys.stdout.reconfigure(encoding='utf-8')

HOST = '193.233.244.217'
USER = 'root'
PWD = os.environ.get('AEMR_SRV_PWD', '')
PUBKEY = open(os.path.expanduser('~/.ssh/id_ed25519.pub')).read().strip()
NEW_USER = 'aemr'

if not PWD:
    print('ERROR: set AEMR_SRV_PWD env var', file=sys.stderr); sys.exit(1)

BOOTSTRAP_SH = f'''#!/usr/bin/env bash
set -e
set -o pipefail
export DEBIAN_FRONTEND=noninteractive
log() {{ echo; echo "==> $1"; }}

log "1/9 apt update + basics"
apt-get update -y >/dev/null
apt-get install -y --no-install-recommends \\
    ca-certificates curl gnupg lsb-release \\
    git vim htop ufw fail2ban unattended-upgrades \\
    sudo software-properties-common jq tzdata \\
    >/dev/null

log "2/9 timezone Asia/Kamchatka"
timedatectl set-timezone Asia/Kamchatka || true
date

log "3/9 swap 2GB"
if ! swapon --show | grep -q /swapfile; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -w vm.swappiness=10 >/dev/null
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi
free -h

log "4/9 ufw firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'
ufw --force enable
ufw status numbered

log "5/9 пользователь {NEW_USER} + sudo + ssh-ключ"
if ! id {NEW_USER} >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo {NEW_USER}
    # без пароля для sudo
    echo "{NEW_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/{NEW_USER}
    chmod 440 /etc/sudoers.d/{NEW_USER}
fi
mkdir -p /home/{NEW_USER}/.ssh
echo "{PUBKEY}" > /home/{NEW_USER}/.ssh/authorized_keys
chmod 700 /home/{NEW_USER}/.ssh
chmod 600 /home/{NEW_USER}/.ssh/authorized_keys
chown -R {NEW_USER}:{NEW_USER} /home/{NEW_USER}/.ssh

# тот же ключ для root — на случай если aemr заблокируется
mkdir -p /root/.ssh
chmod 700 /root/.ssh
grep -qF "{PUBKEY}" /root/.ssh/authorized_keys 2>/dev/null || echo "{PUBKEY}" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

log "6/9 docker + docker compose v2"
if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -y >/dev/null
    apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
usermod -aG docker {NEW_USER}
docker --version
docker compose version

log "7/9 auto-updates безопасности"
echo 'APT::Periodic::Update-Package-Lists "1";' > /etc/apt/apt.conf.d/20auto-upgrades
echo 'APT::Periodic::Unattended-Upgrade "1";' >> /etc/apt/apt.conf.d/20auto-upgrades

log "8/9 sshd hardening: keys-only, без root password"
SSH=/etc/ssh/sshd_config.d/99-aemr.conf
cat > $SSH << 'SSHCFG'
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
ClientAliveInterval 60
ClientAliveCountMax 3
SSHCFG
sshd -t && systemctl reload ssh
echo "sshd reloaded"

log "9/9 fail2ban для ssh"
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban || true

log "DONE — Phase 1 complete"
echo
echo "Server: $(hostname) $(ip -4 addr show | grep -oP '(?<=inet )\\d+\\.\\d+\\.\\d+\\.\\d+' | grep -v 127 | head -1)"
echo "User: {NEW_USER} (sudo nopasswd, ssh-key auth only)"
echo "Docker: $(docker --version)"
'''

print(f'>>> connecting {USER}@{HOST}')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PWD, timeout=15, allow_agent=False, look_for_keys=False)

# upload bootstrap script
sftp = c.open_sftp()
with sftp.open('/root/phase1.sh', 'w') as f:
    f.write(BOOTSTRAP_SH)
sftp.chmod('/root/phase1.sh', 0o755)
sftp.close()
print('>>> uploaded /root/phase1.sh')

# run
print('>>> executing (this takes 2-3 minutes)...')
print('=' * 70)
stdin, stdout, stderr = c.exec_command('bash /root/phase1.sh 2>&1', timeout=600, get_pty=True)
for line in iter(stdout.readline, ''):
    if not line: break
    print(line.rstrip())
ec = stdout.channel.recv_exit_status()
print('=' * 70)
print(f'>>> exit code: {ec}')
c.close()
