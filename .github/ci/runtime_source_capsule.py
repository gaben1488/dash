"""Read owned runtime code only; emit an authenticated CMS capsule, never plaintext."""
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

MAX_SOURCE = 32 * 1024 * 1024
EXTENSIONS = {'.ts', '.tsx', '.py', '.mjs', '.js', '.css'}


def code_files(root):
    files = []
    if not root.is_dir() or root.is_symlink():
        raise ValueError('SOURCE_ROOT_INVALID')
    for file in sorted(root.rglob('*')):
        if file.is_symlink():
            raise ValueError('SOURCE_SYMLINK')
        if (file.is_file() and file.suffix in EXTENSIONS
                and '.test.' not in file.name and '.spec.' not in file.name):
            files.append(file)
    return files


def code_archive(roots):
    result = io.BytesIO()
    observed = {}
    size = 0
    with tarfile.open(fileobj=result, mode='w:gz') as archive:
        for label, root in roots.items():
            if not re.fullmatch('[a-z_]+', label) or not root.is_dir() or root.is_symlink():
                raise ValueError('SOURCE_ROOT_INVALID')
            for file in code_files(root):
                body = file.read_bytes()
                if re.search(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----', body):
                    raise ValueError('SOURCE_PRIVATE_KEY')
                size += len(body)
                if size > MAX_SOURCE:
                    raise ValueError('SOURCE_LIMIT')
                observed[file] = hashlib.sha256(body).digest()
                item = tarfile.TarInfo(f'{label}/{file.relative_to(root).as_posix()}')
                item.size = len(body)
                item.mode = 0o600
                archive.addfile(item, io.BytesIO(body))
    if not observed:
        raise ValueError('SOURCE_EMPTY')
    current = {file for root in roots.values() for file in code_files(root)}
    if (current != set(observed)
            or any(hashlib.sha256(file.read_bytes()).digest() != digest for file, digest in observed.items())):
        raise ValueError('SOURCE_CHANGED_DURING_CAPTURE')
    return result.getvalue()


def owned(record, service):
    labels = record.get('Config', {}).get('Labels') or {}
    return (record.get('Name') == f'/aemr-{service}-1'
            and labels.get('com.docker.compose.project') == 'aemr'
            and labels.get('com.docker.compose.service') == service
            and bool(re.fullmatch('sha256:[a-f0-9]{64}', record.get('Image', ''))))


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, timeout=90, check=False, **kwargs)
    if result.returncode:
        raise ValueError('CAPSULE_COMMAND_FAILED')
    return result.stdout


def collect():
    purelib = Path(command(['/opt/report-env/bin/python', '-c',
                           'import sysconfig;print(sysconfig.get_paths()["purelib"])']).decode().strip())
    roots = {name: Path('/app/packages') / name / 'src' for name in ('shared', 'core', 'server')}
    roots['installed_engine'] = purelib / 'procurement_engine'
    roots['repository_engine'] = Path('/app/packages/report-engine/src/procurement_engine')
    sys.stdout.buffer.write(code_archive(roots))


def capture(certificate):
    os.umask(0o077)
    before = {}
    for service in ('server', 'report-worker', 'web', 'caddy'):
        record = json.loads(command(['docker', 'inspect', f'aemr-{service}-1']))[0]
        if not owned(record, service):
            raise ValueError('SOURCE_RUNTIME_NOT_OWNED')
        before[service] = {'id': record['Id'], 'image': record['Image'],
                           'startedAt': record['State']['StartedAt'], 'restarts': record['RestartCount']}
    helper = Path(__file__).read_bytes()
    with tempfile.TemporaryDirectory(prefix='aemr-source-', dir=certificate.parent) as directory:
        root = Path(directory)
        archives = {}
        for service in ('server', 'report-worker'):
            # Static code + stdlib file reads. No application import, source GET,
            # report generation, business volume traversal or container mutation.
            body = command(['docker', 'exec', '-i', before[service]['id'], 'python3', '-', 'collect'], input=helper)
            if len(body) > MAX_SOURCE:
                raise ValueError('SOURCE_LIMIT')
            (root / f'{service}.tar.gz').write_bytes(body)
            archives[service] = hashlib.sha256(body).hexdigest()
        for service, expected in before.items():
            record = json.loads(command(['docker', 'inspect', f'aemr-{service}-1']))[0]
            if (not owned(record, service) or record['Id'] != expected['id']
                    or record['Image'] != expected['image']
                    or record['State']['StartedAt'] != expected['startedAt']
                    or record['RestartCount'] != expected['restarts']):
                raise ValueError('SOURCE_RUNTIME_CHANGED')
        manifest = {'kind': 'SOURCE_CODE_ONLY', 'runtime': before, 'archive_sha256': archives}
        (root / 'manifest.json').write_text(json.dumps(manifest))
        with tarfile.open(root / 'source.tar', 'w') as archive:
            for name in ('manifest.json', 'server.tar.gz', 'report-worker.tar.gz'):
                archive.add(root / name, arcname=name, recursive=False)
        # OpenSSL CMS authEnvelopedData uses AES-GCM and RSA recipient encryption.
        # Only the public certificate travels to VPS/GitHub; private key stays local.
        command(['openssl', 'cms', '-encrypt', '-aes-256-gcm', '-binary', '-outform', 'DER',
                 '-in', str(root / 'source.tar'), '-out', str(root / 'source.cms'), str(certificate)])
        ciphertext = (root / 'source.cms').read_bytes()
        print('CAPSULE_SHA256=' + hashlib.sha256(ciphertext).hexdigest())
        encoded = base64.b64encode(ciphertext).decode()
        for number, start in enumerate(range(0, len(encoded), 16000)):
            print(f'CAPSULE_CHUNK_{number}=' + encoded[start:start + 16000])
        print('CAPSULE_COMPLETE')


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'collect':
            collect()
        elif sys.argv[1] == 'capture':
            capture(Path(sys.argv[2]))
        else:
            raise ValueError('CAPSULE_MODE_INVALID')
    except Exception as error:  # noqa: BLE001 — privacy boundary: never log arbitrary source/tool errors
        allowed = {'SOURCE_ROOT_INVALID', 'SOURCE_SYMLINK', 'SOURCE_PRIVATE_KEY', 'SOURCE_LIMIT',
                   'SOURCE_EMPTY', 'SOURCE_CHANGED_DURING_CAPTURE', 'SOURCE_RUNTIME_NOT_OWNED',
                   'SOURCE_RUNTIME_CHANGED', 'CAPSULE_COMMAND_FAILED', 'CAPSULE_MODE_INVALID'}
        print(str(error) if str(error) in allowed else 'SOURCE_CAPSULE_UNAVAILABLE', file=sys.stderr)
        sys.exit(2)
