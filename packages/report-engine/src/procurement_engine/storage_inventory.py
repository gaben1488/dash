"""Read-only, bounded accounting of durable report state; no cleanup actions."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import stat
import time
from contextlib import closing
from pathlib import Path

from .readonly_catalog import copied_catalog


def inventory_state(root, *, max_hash_bytes=2 * 1024**3, max_hash_files=512, max_seconds=90):
    root = Path(root)
    started = time.monotonic()
    classes = {name: {'file_count': 0, 'logical_bytes': 0, 'unique_inode_bytes': 0,
                     'allocated_unique_bytes': 0}
               for name in ('published', 'attempts', 'archives', 'inputs', 'other')}
    entries = {}
    seen = set()
    unsafe = 0
    pending = [root]
    while pending:
        directory = pending.pop()
        for path in directory.iterdir():
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                unsafe += 1
            elif stat.S_ISDIR(info.st_mode):
                pending.append(path)
            elif stat.S_ISREG(info.st_mode):
                parts = path.relative_to(root).parts
                kind = parts[1] if len(parts) > 1 and parts[0] == 'reports' and parts[1] in classes else 'other'
                group = classes[kind]
                group['file_count'] += 1
                group['logical_bytes'] += info.st_size
                inode = (info.st_dev, info.st_ino)
                if inode not in seen:
                    seen.add(inode)
                    group['unique_inode_bytes'] += info.st_size
                    group['allocated_unique_bytes'] += info.st_blocks * 512
                entries[path] = info
            else:
                unsafe += 1
    result = {'atomic_freeze': False, 'classes': classes, 'unsafe_entries': unsafe,
              'catalog_claimed_duplicate_bytes': 0, 'verified_duplicate_bytes': 0,
              'verified_groups': 0, 'hash_mismatches': 0, 'unstable_files': 0,
              'verification_complete': True, 'catalog_status': 'UNAVAILABLE'}
    groups = {}
    with copied_catalog(root / 'reports/published/publications.sqlite') as catalog, closing(sqlite3.connect(catalog)) as db:
        records = db.execute('SELECT release_id, files FROM publications').fetchall()
    for release_id, serialized in records:
        if not isinstance(release_id, str) or not re.fullmatch(r'REL-[a-f0-9]{64}', release_id):
            unsafe += 1
            continue
        try:
            files = json.loads(serialized)
        except (TypeError, ValueError):
            unsafe += 1
            continue
        if not isinstance(files, dict):
            unsafe += 1
            continue
        for relative, digest in files.items():
            relative = Path(relative)
            if (relative.is_absolute() or '..' in relative.parts or not relative.parts
                or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest)):
                unsafe += 1
                continue
            path = root / 'reports/published/releases' / release_id / relative
            info = entries.get(path)
            if info is None:
                unsafe += 1
                continue
            groups.setdefault((digest, info.st_size), {})[(info.st_dev, info.st_ino)] = path
    result['unsafe_entries'] = unsafe
    result['catalog_status'] = 'READ'
    hashed_bytes = hashed_files = 0
    for (digest, size), inodes in sorted(groups.items(), key=lambda item: item[0][1]):
        if len(inodes) < 2:
            continue
        result['catalog_claimed_duplicate_bytes'] += size * (len(inodes) - 1)
        verified = 0
        for path in inodes.values():
            if (hashed_bytes + size > max_hash_bytes or hashed_files >= max_hash_files
                or time.monotonic() - started >= max_seconds):
                result['verification_complete'] = False
                continue
            before = entries[path]
            # Opening a moving live path must not follow a newly inserted link.
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'rb') as stream:
                opened = os.fstat(stream.fileno())
                def stamp(value):
                    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns
                if stamp(opened) != stamp(before):
                    result['unstable_files'] += 1
                    result['verification_complete'] = False
                    continue
                digestor = hashlib.sha256()
                remaining = size
                while remaining:
                    if hashed_bytes >= max_hash_bytes or time.monotonic() - started >= max_seconds:
                        break
                    chunk = stream.read(min(1024**2, remaining, max_hash_bytes - hashed_bytes))
                    if not chunk:
                        break
                    digestor.update(chunk)
                    remaining -= len(chunk)
                    hashed_bytes += len(chunk)
                after = os.fstat(stream.fileno())
            hashed_files += 1
            if remaining:
                result['verification_complete'] = False
                continue
            actual = digestor.hexdigest()
            stamps = [(value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
                      for value in (before, opened, after, path.lstat())]
            if len(set(stamps)) != 1:
                result['unstable_files'] += 1
                result['verification_complete'] = False
            elif actual != digest:
                result['hash_mismatches'] += 1
            else:
                verified += 1
        if verified > 1:
            result['verified_duplicate_bytes'] += size * (verified - 1)
            result['verified_groups'] += 1
    result['hashed_bytes'] = hashed_bytes
    result['hashed_files'] = hashed_files
    return result
