"""Small immutable CI runtime contract. Never reads a business source or production DB."""
import argparse
import hashlib
import json
import re
import stat
import subprocess
import zipfile
from pathlib import Path

FORMAT = 'dash-runtime-artifact-v1'
ROLES = ('server', 'web')  # Worker runs the server image; edge Caddy stays bound by the runtime plan.
SOURCE_FILES = (
    'packages/shared/src/schemas.ts', 'packages/shared/src/types.ts',
    'packages/server/src/db/schema.ts', 'packages/server/src/db/index.ts',
    'deploy/release-controller.py', 'deploy/release_recovery.py',
    'deploy/release_trial.py', 'deploy/stateful_backup.py', '.github/ci/source_ci_gate.py',
)
MAX_ARCHIVE = 4 * 1024**3


def require(condition):
    if not condition:
        raise ValueError('RUNTIME_ARTIFACT_REJECTED')


def file_digest(path, limit):
    require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode) and 0 < path.stat().st_size <= limit)
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def image_for(role, sha, inspected):
    tag = f'aemr-{role}:release-{sha}'
    rows = [value for value in inspected if tag in (value.get('RepoTags') or [])]
    require(len(rows) == 1)
    image = rows[0]
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('Id', '')) is not None
            and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64'
            and (image.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') == sha)
    return image['Id'], tag


def create(root, sha, run_id, attempt, inspected, versions, source):
    require(re.fullmatch(r'[a-f0-9]{40}', sha) is not None and type(run_id) is int and run_id > 0
            and type(attempt) is int and attempt > 0 and len(inspected) == 2)
    require(isinstance(versions, dict) and set(versions) == {'node', 'python', 'rules', 'renderer'}
            and all(isinstance(value, str) and 0 < len(value) <= 512 and '\n' not in value for value in versions.values()))
    images = {}
    for role in ROLES:
        identity, tag = image_for(role, sha, inspected)
        path = root / (role + '.tar.gz')
        images[role] = {'id': identity, 'tag': tag, 'archive': path.name,
                        'size': path.stat().st_size, 'sha256': file_digest(path, MAX_ARCHIVE)}
    require(images['server']['id'] != images['web']['id'])
    return {'format': FORMAT, 'source_sha': sha, 'ci': {'run_id': run_id, 'attempt': attempt},
            'platform': 'linux/amd64', 'images': images, 'versions': versions,
            'source_files': {name: file_digest(source / name, 4 * 1024**2) for name in SOURCE_FILES}}


def validate(manifest, sha, run_id, attempt):
    require(isinstance(manifest, dict) and set(manifest) == {'format', 'source_sha', 'ci', 'platform', 'images', 'versions', 'source_files'})
    require(isinstance(manifest['ci'], dict) and set(manifest['ci']) == {'run_id', 'attempt'}
            and all(type(value) is int for value in manifest['ci'].values()))
    require(isinstance(manifest['images'], dict) and isinstance(manifest['versions'], dict) and isinstance(manifest['source_files'], dict))
    require(re.fullmatch(r'[a-f0-9]{40}', sha) is not None and manifest['format'] == FORMAT
            and manifest['source_sha'] == sha and manifest['ci'] == {'run_id': run_id, 'attempt': attempt}
            and type(run_id) is int and run_id > 0 and type(attempt) is int and attempt > 0
            and manifest['platform'] == 'linux/amd64' and set(manifest['images']) == set(ROLES))
    require(set(manifest['source_files']) == set(SOURCE_FILES)
            and all(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) for value in manifest['source_files'].values()))
    require(set(manifest['versions']) == {'node', 'python', 'rules', 'renderer'}
            and all(isinstance(value, str) and 0 < len(value) <= 512 and '\n' not in value for value in manifest['versions'].values()))
    for role in ROLES:
        image = manifest['images'][role]
        require(set(image) == {'id', 'tag', 'archive', 'size', 'sha256'}
                and image['archive'] == role + '.tar.gz' and image['tag'] == f'aemr-{role}:release-{sha}'
                and type(image['size']) is int and 0 < image['size'] <= MAX_ARCHIVE
                and re.fullmatch(r'sha256:[a-f0-9]{64}', image['id']) is not None
                and re.fullmatch(r'[a-f0-9]{64}', image['sha256']) is not None)
    require(manifest['images']['server']['id'] != manifest['images']['web']['id'])


def read_manifest(root):
    file_digest(root / 'manifest.json', 64 * 1024)
    return json.loads((root / 'manifest.json').read_text())


def verify(root, sha, run_id, attempt, source=None):
    require(not root.is_symlink() and {path.name for path in root.iterdir()} == {'manifest.json', 'server.tar.gz', 'web.tar.gz'})
    manifest = read_manifest(root)
    validate(manifest, sha, run_id, attempt)
    for image in manifest['images'].values():
        path = root / image['archive']
        require(file_digest(path, MAX_ARCHIVE) == image['sha256'] and path.stat().st_size == image['size'])
    if source is not None:
        require(all(file_digest(source / name, 4 * 1024**2) == digest for name, digest in manifest['source_files'].items()))
    return manifest


def unpack(root, archive, metadata, sha, run_id, attempt):
    workflow = metadata.get('workflow_run') or {}
    require(metadata.get('name') == 'runtime-' + sha and metadata.get('expired') is False
            and type(metadata.get('id')) is int and metadata['id'] > 0
            and workflow.get('id') == run_id and workflow.get('head_sha') == sha
            and metadata.get('digest') == 'sha256:' + file_digest(archive, 2 * MAX_ARCHIVE + 2 * 1024**2)
            and not root.exists() and not root.is_symlink())
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        require(len(entries) == 3 and {entry.filename for entry in entries} == {'manifest.json', 'server.tar.gz', 'web.tar.gz'})
        for entry in entries:
            limit = 64 * 1024 if entry.filename == 'manifest.json' else MAX_ARCHIVE
            mode = entry.external_attr >> 16
            require(0 < entry.file_size <= limit and not stat.S_ISLNK(mode) and not entry.is_dir())
        root.mkdir(mode=0o700)
        for entry in entries:
            with package.open(entry) as reader, (root / entry.filename).open('xb') as writer:
                count = 0
                while chunk := reader.read(1024 * 1024):
                    count += len(chunk)
                    require(count <= entry.file_size)
                    writer.write(chunk)
                require(count == entry.file_size)
    manifest = read_manifest(root)
    producer = manifest['ci']['attempt']
    require(type(producer) is int and 0 < producer <= attempt)
    validate(manifest, sha, run_id, producer)


def github_api(path, output=None):
    command = ['gh', 'api', path]
    if output is not None:
        with output.open('xb') as stream:
            subprocess.run(command, stdout=stream, stderr=subprocess.DEVNULL, timeout=300, check=True)
        return None
    body = subprocess.check_output(command, stderr=subprocess.DEVNULL, timeout=45)
    require(len(body) <= 1024**2)
    return json.loads(body)


def fetch(root, sha, run_id, attempt, *, api=github_api):
    require(re.fullmatch(r'[a-f0-9]{40}', sha) is not None and type(run_id) is int and run_id > 0
            and type(attempt) is int and attempt > 0)
    prefix = 'repos/gaben1488/dash/actions/'
    listing = api(prefix + f'runs/{run_id}/artifacts?per_page=100')
    require(type(listing['total_count']) is int and 0 <= listing['total_count'] <= 100
            and len(listing['artifacts']) == listing['total_count'])
    rows = [row for row in listing['artifacts'] if row.get('name') == 'runtime-' + sha]
    if not rows:
        return None
    require(len(rows) == 1 and type(rows[0].get('id')) is int and rows[0]['id'] > 0 and rows[0].get('expired') is False)
    metadata = rows[0]
    require((metadata.get('workflow_run') or {}).get('id') == run_id
            and (metadata.get('workflow_run') or {}).get('head_sha') == sha
            and re.fullmatch(r'sha256:[a-f0-9]{64}', metadata.get('digest', '')) is not None)
    archive = root.with_name(root.name + '.zip')
    try:
        api(prefix + f"artifacts/{metadata['id']}/zip", archive)
        unpack(root, archive, metadata, sha, run_id, attempt)
        return {'artifact': metadata, 'manifest': read_manifest(root)}
    finally:
        archive.unlink(missing_ok=True)


def verify_loaded(manifest, inspected):
    validate(manifest, manifest['source_sha'], manifest['ci']['run_id'], manifest['ci']['attempt'])
    require(len(inspected) == 2)
    for role in ROLES:
        require(image_for(role, manifest['source_sha'], inspected)[0] == manifest['images'][role]['id'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('create', 'verify', 'loaded', 'fetch'))
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--run', type=int, required=True)
    parser.add_argument('--attempt', type=int, required=True)
    parser.add_argument('--inspect', type=Path)
    parser.add_argument('--versions', type=Path)
    parser.add_argument('--metadata', type=Path)
    parser.add_argument('--selection', type=Path)
    parser.add_argument('--allow-missing', action='store_true')
    parser.add_argument('--source', type=Path, default=Path('.'))
    args = parser.parse_args()
    try:
        if args.mode == 'create':
            manifest = create(args.root, args.sha, args.run, args.attempt, json.loads(args.inspect.read_text()),
                              json.loads(args.versions.read_text()), args.source)
            (args.root / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True, separators=(',', ':')))
        elif args.mode == 'verify':
            verify(args.root, args.sha, args.run, args.attempt, args.source)
        elif args.mode == 'fetch':
            require(args.selection is not None and args.metadata is not None)
            result = fetch(args.root, args.sha, args.run, args.attempt)
            require(result is not None or args.allow_missing)
            selection = {'present': result is not None}
            if result is not None:
                selection['producer_attempt'] = result['manifest']['ci']['attempt']
                selection['artifact_id'] = result['artifact']['id']
                args.metadata.write_text(json.dumps(result['artifact']))
            args.selection.write_text(json.dumps(selection))
        else:
            manifest = read_manifest(args.root)
            validate(manifest, args.sha, args.run, args.attempt)
            verify_loaded(manifest, json.loads(args.inspect.read_text()))
        print('RUNTIME_ARTIFACT_' + args.mode.upper() + '_PASS')
        return 0
    except (OSError, ValueError, TypeError, KeyError, AttributeError, zipfile.BadZipFile, RuntimeError, subprocess.SubprocessError):
        print('RUNTIME_ARTIFACT_REJECTED')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
