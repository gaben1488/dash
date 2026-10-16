"""Copy a quiescent SQLite catalog plus WAL without opening the production DB.

A mode=ro connection can still need writable shared memory for WAL. Rehearsal
mounts cannot supply it. The byte-stable barrier below copies the complete
catalog into admitted temporary storage, verifies its integrity there, and
keeps immutable release files on the original read-only volume. A moving catalog
is retried, never opened with immutable=1 (which would ignore committed WAL).
"""
from __future__ import annotations

import hashlib
import shutil
import sqlite3
import tempfile
from contextlib import closing, contextmanager
from pathlib import Path


def _stamp(path):
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file():
        raise ValueError('PUBLICATION_CATALOG_UNSAFE')
    stat = path.stat()
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return stat.st_ino, stat.st_size, stat.st_mtime_ns, digest


@contextmanager
def copied_catalog(source):
    """Yield a temporary database iff DB and WAL stayed unchanged across copying."""
    source = Path(source)
    paths = [source, source.with_name(source.name + '-wal')]
    for _ in range(3):
        with tempfile.TemporaryDirectory(prefix='report-catalog-') as folder:
            try:
                before = [_stamp(path) for path in paths]
            except FileNotFoundError:
                continue
            if before[0] is None:
                raise ValueError('PUBLICATION_NOT_FOUND')
            # A copy plus WAL recovery/checkpoint may grow the cloned main DB.
            # Admit the actual scratch filesystem, never assume /tmp is a disk.
            required = 2 * sum(stamp[1] for stamp in before if stamp is not None) + 1024**2
            if shutil.disk_usage(folder).free < required:
                raise ValueError('PUBLICATION_CATALOG_SCRATCH_INSUFFICIENT')
            target = Path(folder) / source.name
            try:
                for path, stamp in zip(paths, before):
                    if stamp is not None:
                        shutil.copyfile(path, Path(folder) / path.name)
            except FileNotFoundError:
                continue  # A WAL checkpoint can remove/replace a source file.
            try:
                after = [_stamp(path) for path in paths]
            except FileNotFoundError:
                continue
            if before != after:
                continue
            with closing(sqlite3.connect(target)) as database:
                if database.execute('PRAGMA quick_check').fetchone() != ('ok',):
                    raise ValueError('PUBLICATION_CATALOG_CORRUPT')
            yield target
            return
    raise ValueError('PUBLICATION_CATALOG_CHANGED_DURING_COPY')
