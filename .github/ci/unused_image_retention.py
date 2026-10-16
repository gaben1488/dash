"""Retire a sampled set of untagged images after proving no runtime references."""
import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

EXPECTED = [
    "sha256:0e4d68b3ccdf223ba96bed15e0e25e244b6623e8bbfae973e4669978c82d04bb",
    "sha256:243f0d34c33772e67448588d98060aed9a0393957ba3ea9ac2d166cc9e42cee3",
    "sha256:25cc26392c6384e8f4ca4de2473b9a17e480cbadad44dad54261c1214ae1f04b",
    "sha256:28c26577fee50213f76a4398d735b274c82ab4e7c92808962883998597c7de77",
    "sha256:2d422cf76551d1fc605c845157ac5b0abffa4a42b6ef202de27ab8d36e0b820a",
    "sha256:3795ee3ef6160c488af7a4d7843654028d328a1e413bf95b57779f6ec2ec0e5f",
    "sha256:42f79cb333fc82a58e84194ed5583feda42fcec1fccc1e87a71f6e5c609b8458",
    "sha256:61b03fd46298d6dc714340c477edb9af01f123237d7b8bf128a387b65ab644ce",
    "sha256:63044e548ee9086828bbc43e41b03c991016350a390c1896dc76b81fc4763388",
    "sha256:75c2e61386b2964c3939fbdc8b1092aec45f1b9c8a893b3b3c91cc500ec4593c",
    "sha256:9c9d45fb2493a4ab850aa41ed536ac0504c156523c64237c609e4b428a4f6ac8",
    "sha256:b0ca408d8242e968d35bfe28477b582d8340b67372d002a3db09d8fb0edb8d68",
    "sha256:b1cc489768c1a84764e0bcc26f96d5a4d6840b8261056a07e358cf3be46516ae",
    "sha256:b622746065c37fe17ecfb31ee0ba47f4a9f7dbdf610f8f5080e110d1e9adb92f",
    "sha256:b658fff92905891496321e4c27f56c2f1219020d43c8be27f129ec1b99e39b94",
    "sha256:ba912e9b24917ff24788a66e17c72ca5189c07c36b6d0c5d23f668ce3a38fa59",
    "sha256:bba933c670d5af1cfdb69b4731e588fea723a6de7c7c9288a74ef5127a8e4bb0",
    "sha256:cf9ef22a06483be5b70ff01a03d7df1beabcd3c662f225a0cd052e64895a79ea",
    "sha256:d2c59635e49971885f9ca30324cb50fddbb9d84a5f9b81ff99a56c069108657f",
    "sha256:d7f124a6ab8724e0bdb0237dce7d1338c0a57b45dc0fbb1a545e39a531a8c5db",
    "sha256:ec2b08d2b5fb69a0df02bb638e1161075b495273470ffb193c085e6884db3687",
    "sha256:f837f850b3929299292ca687c3addd96f7361171f2f343421ec6a44882203a72",
    "sha256:fb1870ef2fd8a93979e1c34b5fa25cd99aebbdaa598698817ef8fa1fdcf8101d"
]
STATE = Path('/var/lib/aemr')
BACKUPS = Path('/home/aemr/.dash-private-backups')
SHA = '43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa'
SOURCE_SHA256 = os.environ.get('IMAGE_RETENTION_SHA', '')
LOCK_FD = None
PHASE = 'ADMISSION'


def require(value):
    if not value:
        raise ValueError('IMAGE_RETENTION_BLOCKED')


def references(value):
    if isinstance(value, str):
        return {value} if re.fullmatch('sha256:[a-f0-9]{64}', value) else set()
    if isinstance(value, dict):
        return set().union(*(references(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(references(item) for item in value))
    return set()


def select_images(images, containers, protected, expected):
    require(len(expected) == len(set(expected)) and all(re.fullmatch('sha256:[a-f0-9]{64}', value) for value in expected))
    used = protected | {record['Image'] for record in containers}
    return sorted(record['Id'] for record in images if record['Id'] in expected
                  and record['Id'] not in used and not record.get('RepoTags') and not record.get('RepoDigests'))


def retire(plan, observe, remove):
    remaining = list(plan['selected'])
    require(observe() == plan)
    for identity in plan['selected']:
        require(observe() == {**plan, 'selected': remaining})
        remove(identity)
        remaining.remove(identity)
    require(observe() == {**plan, 'selected': []})


def remove_image(identity):
    # Docker otherwise recursively prunes untagged parents outside our plan.
    command(['image', 'rm', '--no-prune', identity])


def command(arguments):
    result = subprocess.run(['docker', *arguments], capture_output=True, text=True, timeout=45, check=False,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'DOCKER_CONFIG': '/etc/aemr/docker'},
        pass_fds=() if LOCK_FD is None else (LOCK_FD,))
    require(result.returncode == 0 and len(result.stdout) <= 32 * 1024**2)
    return result.stdout


def owned(path):
    require(not any(parent.is_symlink() for parent in (path, *path.parents)))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 4 * 1024**2)
        return stream.read(4 * 1024**2 + 1)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def observe():
    global PHASE
    PHASE = 'REFERENCE_FILES'
    require(not any(os.path.lexists(STATE / name) for name in ('pending-release.json', 'release-recovery-progress.json')))
    require(not list(BACKUPS.glob('*/quiescent')))
    paths = sorted(set((STATE / 'release-runtime').rglob('*.json'))
        | set(STATE.glob('release-*.json')) | set((STATE / 'worker-quarantine').glob('*.json'))
        | set(BACKUPS.glob('*/runtime.json')) | set(BACKUPS.glob('*/release-window.json'))
        | set(BACKUPS.glob('*/plan-prepared.json')))
    require(0 < len(paths) <= 256)
    protected, stamps, total = set(), {}, 0
    for path in paths:
        body = owned(path)
        total += len(body)
        require(total <= 16 * 1024**2)
        protected |= references(json.loads(body))
        stamps[str(path)] = hashlib.sha256(body).hexdigest()
    PHASE = 'ACCEPTED_RELEASE'
    plan = json.loads(owned(STATE / 'release-runtime/trial-plan.json'))
    accepted = json.loads(owned(STATE / 'release-accepted.json'))['acceptance']
    require(plan['release_sha'] == accepted['release_sha'] == SHA
            and plan['candidate_images'] == accepted['candidate_images'])
    PHASE = 'RUNTIME'
    identifiers = command(['ps', '--all', '--quiet', '--no-trunc']).split()
    require(0 < len(identifiers) <= 64 and all(re.fullmatch('[a-f0-9]{64}', value) for value in identifiers))
    containers = json.loads(command(['inspect', *identifiers]))
    core = {}
    for role in ('server', 'report-worker', 'web', 'caddy'):
        rows = [record for record in containers if record['Name'] == '/aemr-' + role + '-1']
        require(len(rows) == 1)
        record = rows[0]
        labels = record['Config'].get('Labels') or {}
        require(record['Image'] == plan['candidate_images'][role] and record['State']['Status'] == 'running'
            and not record['State']['OOMKilled'] and labels.get('com.docker.compose.project') == 'aemr'
            and labels.get('com.docker.compose.service') == role)
        if role == 'server':
            require(record['State']['Health']['Status'] == 'healthy')
        core[role] = {key: record.get(key) for key in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts', 'RestartCount')}
        core[role]['Mounts'] = sorted(json.dumps(value, sort_keys=True) for value in record.get('Mounts', []))
        core[role]['state'] = {key: record['State'].get(key) for key in ('StartedAt', 'Status', 'OOMKilled')}
    PHASE = 'IMAGES'
    identifiers = sorted(set(command(['image', 'ls', '--all', '--quiet', '--no-trunc']).split()))
    require(0 < len(identifiers) <= 64 and all(re.fullmatch('sha256:[a-f0-9]{64}', value) for value in identifiers))
    images = json.loads(command(['image', 'inspect', *identifiers]))
    return {'selected': select_images(images, containers, protected, EXPECTED),
            'reference_digest': digest(stamps), 'runtime_digest': digest(core),
            'operator_sha256': SOURCE_SHA256}


def atomic_json(path, value):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if temporary.exists():
                temporary.unlink()


def main():
    global LOCK_FD
    require(os.geteuid() == 0 and sys.argv[1:] in (['plan'], ['apply'])
            and re.fullmatch('[a-f0-9]{64}', SOURCE_SHA256))
    os.umask(0o077)
    lock_path = Path('/run/lock/aemr-maintenance.lock')
    require(not any(path.is_symlink() for path in (lock_path, *lock_path.parents)))
    with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW), 'r+') as lock:
        info = os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        LOCK_FD = lock.fileno()
        root = STATE / 'image-retention'
        require(not root.is_symlink())
        root.mkdir(mode=0o700, exist_ok=True)
        require(root.stat().st_uid == 0 and stat.S_IMODE(root.stat().st_mode) == 0o700)
        if sys.argv[1] == 'plan':
            plan = observe()
            atomic_json(root / 'plan.json', plan)
            print(json.dumps({'status': 'UNREFERENCED_IMAGES_DRY_RUN', 'selected_ids': plan['selected'],
                              'free_bytes': shutil.disk_usage('/var/lib/docker').free}))
            return
        plan = json.loads(owned(root / 'plan.json'))
        before = shutil.disk_usage('/var/lib/docker').free
        retire(plan, observe, remove_image)
        result = {'status': 'UNREFERENCED_IMAGES_RETIRED_RUNTIME_UNCHANGED', 'removed': len(plan['selected']),
                  'free_before_bytes': before, 'free_after_bytes': shutil.disk_usage('/var/lib/docker').free}
        atomic_json(root / 'result.json', result)
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:  # noqa: BLE001 - project only fixed enums from private metadata.
        known = {'ValueError', 'OSError', 'FileNotFoundError', 'PermissionError', 'BlockingIOError',
                 'JSONDecodeError', 'TimeoutExpired', 'KeyError', 'TypeError'}
        print(json.dumps({'status': 'UNREFERENCED_IMAGE_RETENTION_BLOCKED', 'phase': PHASE,
                          'error_class': type(error).__name__ if type(error).__name__ in known else 'OTHER'}))
        raise SystemExit(2) from None

