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
    'sha256:496aaab4a99a9f861e1c2a930d28db8d0dd2d7bbe3832e5acbbfd8d4716d32aa',
    'sha256:dad30bd43487e748d44170e21f86a02d10d9426c22144d35676a20a38e649390',
]
STATE = Path('/var/lib/aemr')
BACKUPS = Path('/home/aemr/.dash-private-backups')
SHA = '78d293b217a8afe982583c73bc67aaccdb4d906c'
SOURCE_SHA256 = os.environ.get('IMAGE_RETENTION_SHA', '')
LOCK_FD = None
PHASE = 'ADMISSION'
CAPACITY_MODE = False
CAPACITY_SOURCE = 'b24a6a5dead4295f7bc61938a704554c8c9eef72'
CAPACITY_CANDIDATE = 'b24a6a5dead4295f7bc61938a704554c8c9eef72'
# Keep the preceding B24 cleanup receipt immutable; this operation owns a new root.
CAPACITY_PLAN = '701231369a214dae36eaa8b83caa6b0e0dea29e3'
# Exact sampled deployment caches only. Business data and backup archives are never removed.
CAPACITY_TARGETS = {
    'sha256:084554aaf05ab541bb95cc9ff756246d9ba4c454061945e419dcbe39c2a658e6': 'd40222eac54d7cf9df13b04c5cbb32925c0e1115',
}


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


def inventory_images(images, containers, protected):
    """Read-only census; it does not authorize any new image for retirement."""
    require(len(images) <= 64)
    used = protected | {record['Image'] for record in containers}
    rows = []
    for record in images:
        identity, size = record['Id'], record.get('Size')
        require(re.fullmatch('sha256:[a-f0-9]{64}', identity)
                and type(size) is int and 0 <= size <= 2**63-1)
        tags, digests = record.get('RepoTags') or [], record.get('RepoDigests') or []
        require(isinstance(tags, list) and isinstance(digests, list) and max(len(tags), len(digests)) <= 64)
        source = (record.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision')
        rows.append({'image': identity, 'logical_bytes': size, 'protected': identity in used,
            'referenced_by_container': any(row['Image'] == identity for row in containers),
            'release_tags': [tag for tag in tags if re.fullmatch(r'aemr-(?:server|web):release-[a-f0-9]{40}', tag)],
            'tag_count': len(tags), 'digest_count': len(digests),
            'local_self_digests_only': all(value == 'aemr-server@'+identity or value == 'aemr-web@'+identity for value in digests),
            'source_sha': source if isinstance(source, str) and re.fullmatch('[a-f0-9]{40}', source) else None})
    return rows


def select_capacity_images(images, containers, protected):
    admitted = []
    for record in images:
        source = CAPACITY_TARGETS.get(record.get('Id'))
        if (source and record.get('RepoTags') == ['aemr-server:release-' + source]
                and record.get('RepoDigests') in (None, [], ['aemr-server@' + record['Id']])
                and (record.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') == source):
            # Docker29/containerd retains this exact local self-digest on load.
            # A different digest or registry name remains ineligible.
            admitted.append({**record, 'RepoTags': [], 'RepoDigests': []})
    return select_images(admitted, containers, protected, list(CAPACITY_TARGETS))


def layer_estimates(usage, selected):
    require(isinstance(usage, dict) and isinstance(usage.get('Images'), list) and len(usage['Images']) <= 256)
    images = {row['Id']: row for row in usage['Images']}
    require(len(images) == len(usage['Images']))
    rows = []
    for identity in selected:
        row = images.get(identity, {})
        total, shared = row.get('Size'), row.get('SharedSize')
        require(type(total) is int and type(shared) is int and 0 <= shared <= total <= 2**63-1
                and type(row.get('Containers')) is int and row['Containers'] == 0)
        rows.append({'image': identity, 'engine_reported_size_bytes': total,
                     'engine_reported_shared_bytes': shared, 'engine_reported_unique_bytes': total-shared})
    return {'images': rows, 'engine_reported_unique_bytes': sum(row['engine_reported_unique_bytes'] for row in rows),
            'physical_reclaimed_bytes_measured': False}


def read_image_layers():
    import http.client
    import socket
    endpoint = Path('/run/docker.sock')
    info = endpoint.lstat()
    require(stat.S_ISSOCK(info.st_mode) and info.st_uid == 0)
    connection = http.client.HTTPConnection('localhost', timeout=30)
    try:
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(30)
        connection.sock.connect(str(endpoint))
        connection.request('GET', '/v1.52/system/df?type=image')
        response = connection.getresponse()
        body = response.read(4*1024**2+1)
        require(response.status == 200 and len(body) <= 4*1024**2
                and endpoint.lstat().st_ino == info.st_ino)
        return json.loads(body)
    finally:
        connection.close()


def inventory_layer_estimates(usage, inventory):
    selected = [row['image'] for row in inventory if not row['protected']
                and row['tag_count'] == 1 and row['release_tags']
                and row['local_self_digests_only'] and row['source_sha']]
    return layer_estimates(usage, selected)


def read_capacity_forecast():
    # Repeat the existing release preflight read-only; do not create its
    # previous-checkpoint.json or read any business payload files.
    sys.path.insert(0, '/usr/local/libexec/aemr')
    import release_recovery as recovery
    recovery.require_lock(LOCK_FD)
    stage = json.loads(recovery.read_owned(STATE / 'release-runtime/stage.json'))
    source = recovery.ReleaseRecovery(lock_fd=LOCK_FD)._volume(stage)
    size = int(subprocess.check_output(
        ['du', '--summarize', '--bytes', '--count-links', '--', str(source)],
        text=True, timeout=90, pass_fds=(LOCK_FD,)).split()[0])
    plan = recovery.validate_plan(json.loads(recovery.read_owned(recovery.RUNTIME_DIR / 'trial-plan.json')))
    manifest = recovery.BACKUP_BASE / plan['backup_reference'] / 'manifest.json'
    require(not any(path.is_symlink() for path in (manifest, *manifest.parents)))
    body = recovery.read_owned(manifest, limit=16*1024**2)
    require(hashlib.sha256(body).hexdigest() == plan['manifest_sha256'])
    previous = json.loads(body)
    require(previous.get('format') == 2 and all(type(previous.get(key)) is int and previous[key] > 0
            for key in ('archive_bytes', 'bytes')) and size > 0)
    estimate = previous['archive_bytes'] + max(0, size-previous['bytes'])
    required = estimate + max(256*1024**2, (estimate+9)//10) + 1024**3
    return {'source_bytes': size, 'archive_estimate_bytes': estimate,
            'vps_backup_required_bytes': max(4*1024**3, required),
            'vps_backup_free_bytes': shutil.disk_usage(BACKUPS).free}


def capsule_has_state_archive(capsule):
    # A deleted predecessor archive is no longer a restore root. Its metadata
    # remains in the ledger; every extant (even dangling) archive still protects
    # its images. Current plan, stage and accepted state are always separate roots.
    return any(os.path.lexists(path) for path in capsule.glob('*/state.tar.gz'))


def retire(plan, observe, remove):
    remaining = list(plan['selected'])
    require(observe() == plan)
    for identity in plan['selected']:
        require(observe() == {**plan, 'selected': remaining})
        remove(identity)
        remaining.remove(identity)
    require(observe() == {**plan, 'selected': []})


def verify_completed(result, current):
    require(result.get('status') == 'UNREFERENCED_IMAGES_RETIRED_RUNTIME_UNCHANGED'
            and result.get('removed') == len(EXPECTED) and result.get('selected_ids') == EXPECTED
            and result.get('source_sha') == SHA and result.get('operator_sha256') == SOURCE_SHA256
            and current.get('selected') == [] and current.get('protected_selected_ids') == [])


def remove_image(identity):
    # Docker otherwise recursively prunes untagged parents outside our plan.
    command(['image', 'rm', '--no-prune', identity])


def command(arguments):
    result = subprocess.run(['docker', *arguments], capture_output=True, text=True, timeout=45, check=False,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'DOCKER_CONFIG': '/etc/aemr/docker'},
        pass_fds=() if LOCK_FD is None else (LOCK_FD,))
    require(result.returncode == 0 and len(result.stdout) <= 32 * 1024**2)
    return result.stdout


def owned(path, *, reference_only=False):
    require(not any(parent.is_symlink() for parent in (path, *path.parents)))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        info = os.fstat(stream.fileno())
        # Old operator-owned capsules may only ADD protected IDs. Actual
        # accepted/plan authority is separately read as root600 below.
        owners = {0, 1000} if reference_only else {0}
        if not (stat.S_ISREG(info.st_mode) and info.st_uid in owners and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 4 * 1024**2):
            print(json.dumps({'status': 'IMAGE_REFERENCE_METADATA_REJECTED', 'uid': info.st_uid,
                'mode': stat.S_IMODE(info.st_mode), 'links': info.st_nlink, 'bytes': info.st_size}))
        require(stat.S_ISREG(info.st_mode) and info.st_uid in owners and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 4 * 1024**2)
        return stream.read(4 * 1024**2 + 1)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def observe(*, diagnostics=False, inventory=False):
    global PHASE
    PHASE = 'REFERENCE_FILES'
    require(not any(os.path.lexists(STATE / name) for name in ('pending-release.json', 'release-recovery-progress.json')))
    require(not list(BACKUPS.glob('*/quiescent')))
    # Enumerate the actual image-bearing custody documents, not arbitrary
    # payload/evidence JSON under the operational tree.
    fixed = [STATE / name for name in ('release-runtime/trial-plan.json', 'release-runtime/base-plan.json',
        'release-runtime/stage.json', 'release-runtime/trial-proof.json', 'release-runtime/source-ci.json',
        'release-runtime/compose.json', 'release-runtime/candidate-compose.json',
        'release-runtime/candidate-resume.json', 'release-runtime/recovery-compose.json',
        'release-accepted.json', 'release-recovered.json', 'worker-quarantine/quarantine.json',
        'worker-quarantine/rollback-lineage.json')]
    paths = sorted({path for path in fixed if os.path.lexists(path)}
        | set(BACKUPS.glob('*/runtime.json')) | set(BACKUPS.glob('*/release-window.json'))
        | set(BACKUPS.glob('*/plan-prepared.json')))
    require(0 < len(paths) <= 256)
    protected, stamps, total = set(), {}, 0
    protection = {identity: set() for identity in CAPACITY_TARGETS}
    for path in paths:
        body = owned(path, reference_only=True)
        total += len(body)
        require(total <= 16 * 1024**2)
        is_capsule = path.is_relative_to(BACKUPS)
        retained_archive = is_capsule and capsule_has_state_archive(path.parent)
        if not CAPACITY_MODE or not is_capsule or retained_archive:
            observed = references(json.loads(body))
            protected |= observed
            if CAPACITY_MODE:
                kind = 'retained_backup_capsule' if is_capsule else path.name
                for identity in set(CAPACITY_TARGETS) & observed:
                    protection[identity].add(kind)
        stamps[str(path)] = hashlib.sha256(body).hexdigest()
        if CAPACITY_MODE and is_capsule:
            stamps[str(path) + ':state_archive_present'] = retained_archive
    if CAPACITY_MODE:
        stage = json.loads(owned(STATE / 'release-runtime/stage.json'))
        require(stage.get('release_sha') == CAPACITY_CANDIDATE)
    PHASE = 'ACCEPTED_RELEASE'
    plan = json.loads(owned(STATE / 'release-runtime/trial-plan.json'))
    marker = json.loads(owned(STATE / 'release-accepted.json'))
    accepted = marker['acceptance']
    if CAPACITY_MODE:
        require(marker.get('plan_sha256') == digest(plan)
                and accepted.get('state') == 'RELEASE_CANDIDATE_ACCEPTED'
                and accepted.get('manifest_sha256') == plan.get('manifest_sha256'))
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
    selected = (select_capacity_images(images, containers, protected) if CAPACITY_MODE
                else select_images(images, containers, protected, EXPECTED))
    return {'selected': selected,
            'protected_selected_ids': sorted(set(EXPECTED) & (protected | {row['Image'] for row in containers})),
            'reference_digest': digest(stamps), 'runtime_digest': digest(core),
            'operator_sha256': SOURCE_SHA256,
            **({'image_inventory': inventory_images(images, containers, protected)} if inventory else {}),
            **({'capacity_protection': {key: sorted(value) for key, value in protection.items()}} if CAPACITY_MODE else {}),
            **({'capacity_eligibility': {identity: {
                    'present': any(row['Id'] == identity for row in images),
                    'exact_metadata': bool(select_capacity_images([row for row in images if row['Id'] == identity], [], set())),
                    'tag_exact': any(row.get('RepoTags') == ['aemr-server:release-' + CAPACITY_TARGETS[identity]] for row in images if row['Id'] == identity),
                    'source_exact': any((row.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') == CAPACITY_TARGETS[identity] for row in images if row['Id'] == identity),
                    'registry_digests': [ref.removeprefix('aemr-server@') if isinstance(ref, str) and re.fullmatch('aemr-server@sha256:[a-f0-9]{64}', ref) else 'UNRECOGNIZED'
                        for row in images if row['Id'] == identity for ref in (row.get('RepoDigests') or [])][:8]}

                    for identity in CAPACITY_TARGETS}} if CAPACITY_MODE and diagnostics else {})}


def atomic_json(path, value):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary.exists():
                temporary.unlink()


def main():
    global LOCK_FD, CAPACITY_MODE, EXPECTED, SHA, CAPACITY_CANDIDATE
    census = len(sys.argv) == 4 and sys.argv[1] == 'capacity-census'
    if census:
        require(all(re.fullmatch('[a-f0-9]{40}', value) for value in sys.argv[2:]))
        CAPACITY_MODE = True
        SHA, CAPACITY_CANDIDATE = sys.argv[2:]
    if sys.argv[1:] in (['capacity-plan'], ['capacity-apply']):
        CAPACITY_MODE = True
        EXPECTED = sorted(CAPACITY_TARGETS)
        SHA = CAPACITY_SOURCE
    require(os.geteuid() == 0 and (census or sys.argv[1:] in (['plan'], ['apply'], ['verify-completed'], ['capacity-plan'], ['capacity-apply']))
            and re.fullmatch('[a-f0-9]{64}', SOURCE_SHA256))
    os.umask(0o077)
    lock_path = Path('/run/lock/aemr-maintenance.lock')
    require(not any(path.is_symlink() for path in (lock_path, *lock_path.parents)))
    with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW), 'r+') as lock:
        info = os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        LOCK_FD = lock.fileno()
        if census:
            result = observe(inventory=True)
            print(json.dumps({'status': 'READ_ONLY_IMAGE_CAPACITY_CENSUS', **result,
                              'free_bytes': shutil.disk_usage('/var/lib/docker').free}))
            print(json.dumps({'status': 'READ_ONLY_IMAGE_LAYER_ESTIMATES',
                              **inventory_layer_estimates(read_image_layers(), result['image_inventory'])}))
            print(json.dumps({'status': 'READ_ONLY_BACKUP_CAPACITY_FORECAST', **read_capacity_forecast()}))
            return
        require(not CAPACITY_MODE or re.fullmatch('[a-f0-9]{40}', CAPACITY_PLAN))
        root = STATE / ('image-retention-capacity-'+CAPACITY_PLAN if CAPACITY_MODE else 'image-retention')
        require(not root.is_symlink())
        root.mkdir(mode=0o700, exist_ok=True)
        require(root.stat().st_uid == 0 and stat.S_IMODE(root.stat().st_mode) == 0o700)
        if sys.argv[1] == 'verify-completed':
            result = json.loads(owned(root / 'result.json'))
            verify_completed(result, observe())
            print(json.dumps({'status': 'PREVIOUS_IMAGE_RETIREMENT_VERIFIED', 'removed': result['removed'],
                              'free_bytes': shutil.disk_usage('/var/lib/docker').free}))
            return
        if sys.argv[1] in ('plan', 'capacity-plan'):
            plan = observe(diagnostics=CAPACITY_MODE)
            if CAPACITY_MODE:
                print(json.dumps({'status': 'CAPACITY_IMAGE_PLAN', 'selected_ids': plan['selected'],
                                  'protected_selected_ids': plan['protected_selected_ids'],
                                  **{key: plan[key] for key in ('capacity_protection', 'capacity_eligibility')}}), flush=True)
                require(plan['selected'] == EXPECTED and not plan['protected_selected_ids'])
                plan.pop('capacity_eligibility')
                print(json.dumps({'status': 'IMAGE_LAYER_DRY_RUN',
                                  **layer_estimates(read_image_layers(), plan['selected'])}), flush=True)
            atomic_json(root / 'plan.json', plan)
            print(json.dumps({'status': 'UNREFERENCED_IMAGES_DRY_RUN', 'selected_ids': plan['selected'],
                              'free_bytes': shutil.disk_usage('/var/lib/docker').free}))
            return
        plan = json.loads(owned(root / 'plan.json'))
        before = shutil.disk_usage('/var/lib/docker').free
        retire(plan, observe, remove_image)
        result = {'status': 'UNREFERENCED_IMAGES_RETIRED_RUNTIME_UNCHANGED', 'removed': len(plan['selected']),
                  'selected_ids': plan['selected'], 'operator_sha256': SOURCE_SHA256, 'source_sha': SHA,
                  'reference_digest': plan['reference_digest'], 'runtime_digest': plan['runtime_digest'],
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

