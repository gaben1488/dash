"""Bound old project images while preserving every installed recovery reference."""
import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path


def plan_images(images, protected, now):
    return [image for image in images
            if image['Id'] not in protected and len(image.get('RepoTags') or []) == 1
            and image['RepoTags'][0].split(':')[0] in {'aemr-server', 'aemr-web', 'aemr-worker'}
            and datetime.fromisoformat(image['Created'].replace('Z', '+00:00')) < now - timedelta(days=7)]


def docker(*arguments):
    return subprocess.check_output(['docker', *arguments], text=True, timeout=120)


def main():
    import fcntl

    with open('/run/lock/aemr-maintenance.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 75
        state = Path('/var/lib/aemr')
        if any(os.path.lexists(state / name) for name in
               ('pending-release.json', 'release-recovery-progress.json')):
            return 75
        identifiers = docker('ps', '-aq').split()
        containers = json.loads(docker('inspect', *identifiers)) if identifiers else []
        references = {container['Image'] for container in containers}
        for name in ('compose.json', 'candidate-compose.json', 'recovery-compose.json'):
            compose = json.loads((state / 'release-runtime' / name).read_text())
            references.update(service['image'] for service in compose['services'].values())
        environment = Path('/etc/aemr/storage-maintenance.env').read_text()
        maintenance = re.findall(r'^AEMR_STORAGE_IMAGE=(sha256:[a-f0-9]{64})$', environment, re.MULTILINE)
        if len(maintenance) != 1:
            raise ValueError('STORAGE_IMAGE_PIN_INVALID')
        references.update(maintenance)
        protected = {image['Id'] for image in json.loads(docker('image', 'inspect', *sorted(references)))}
        images = sorted(set(docker('image', 'ls', '-q', '--no-trunc').split()))
        inventory = json.loads(docker('image', 'inspect', *images)) if images else []
        selected = plan_images(inventory, protected, datetime.now(timezone.utc))
        removed = []
        for image in selected:
            # Address immutable IDs, never movable tags; no force or volume pruning.
            docker('image', 'rm', image['Id'])
            removed.append(image['Id'])
        result = {'checked_at': datetime.now(timezone.utc).isoformat(),
                  'protected_count': len(protected), 'removed': removed}
        temporary = state / 'storage-images-status.tmp'
        temporary.write_text(json.dumps(result))
        temporary.replace(state / 'storage-images-status.json')
        print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
