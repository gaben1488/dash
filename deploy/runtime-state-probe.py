#!/usr/bin/env python3
"""Read-only Docker state comparison; emit counts, never mounts or environment."""
import json
import subprocess


def canonical_mounts(container):
    return sorted(json.dumps(m, sort_keys=True) for m in container['mounts'])


def compare(before, after):
    old = {c['id']: c for c in before['containers']}
    new = {c['id']: c for c in after['containers']}
    common = old.keys() & new.keys()
    runtime_fields = ('image', 'status', 'started', 'restarts', 'oom')
    runtime = sum(any(old[k].get(f) != new[k].get(f) for f in runtime_fields) for k in common)
    mounts = sum(canonical_mounts(old[k]) != canonical_mounts(new[k]) for k in common)
    raw_order = any(old[k]['mounts'] != new[k]['mounts'] and
                    canonical_mounts(old[k]) == canonical_mounts(new[k]) for k in common)

    def tags(sample):
        return {(i['Repository'], i['Tag']): i['ID'] for i in sample['images']
                if i['Repository'] != '<none>' and i['Tag'] != '<none>'}

    def dangling(sample):
        return {i['ID'] for i in sample['images']
                if i['Repository'] == '<none>' or i['Tag'] == '<none>'}

    old_tags, new_tags = tags(before), tags(after)
    tag_changes = sum(old_tags.get(k) != new_tags.get(k) for k in old_tags.keys() | new_tags.keys())
    result = {'containers_added': len(new.keys() - old.keys()),
              'containers_removed': len(old.keys() - new.keys()),
              'runtime_changes': runtime, 'mount_changes': mounts,
              'raw_mount_order_changed': raw_order, 'protected_tag_changes': tag_changes,
              'dangling_changes': len(dangling(before) ^ dangling(after))}
    result['status'] = 'TECHNICAL_STATE_CHANGED' if any(v for k, v in result.items()
                                                            if k != 'raw_mount_order_changed') else 'TECHNICAL_STATE_STABLE'
    return result


def docker(*args):
    return subprocess.run(['docker', *args], check=True, capture_output=True, text=True, timeout=30).stdout


def capture():
    ids = docker('ps', '--all', '--filter', 'label=com.docker.compose.project', '--filter',
                 'label=com.docker.compose.oneoff=False', '--quiet', '--no-trunc').split()
    if not ids:
        raise ValueError('PROTECTED_CONTAINERS_MISSING')
    containers = []
    template = ('{"id":{{json .Id}},"image":{{json .Image}},"status":{{json .State.Status}},'
                '"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}},'
                '"oom":{{json .State.OOMKilled}},"mounts":{{json .Mounts}}}')
    for container in ids:
        containers.append(json.loads(docker('inspect', '--format', template, container)))
    images = [json.loads(row) for row in docker('image', 'ls', '--all', '--no-trunc',
                                               '--format', '{{json .}}').splitlines()]
    return {'containers': containers, 'images': images}


def main():
    try:
        before, after = capture(), capture()
        result = compare(before, after)
        result['container_count'] = len(after['containers'])
        result['image_entries'] = len(after['images'])
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, KeyError, subprocess.SubprocessError, OSError):
        print('{"status":"RUNTIME_READBACK_UNAVAILABLE"}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
