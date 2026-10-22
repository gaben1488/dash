#!/usr/bin/env python3
"""Offline fresh start. Caller must hold maintenance lock and stop all writers.

Move old state outside the active volume for rollback. Preserve source credentials
and explicit owner decisions, never old snapshots, publications or identity links.
"""
import argparse
import json
import os
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path

DECISIONS = ('mapping_overrides', 'yearlong_kind_overrides')


def reset_current(source, backup):
    source, backup = Path(source), Path(backup)
    if (not source.is_absolute() or source.resolve() != source or not source.is_dir()
            or not backup.is_absolute() or backup.exists() or backup.is_symlink()
            or backup.parent.resolve() != backup.parent
            or source == backup.parent or source in backup.parents
            or os.stat(source).st_dev != os.stat(backup.parent).st_dev):
        raise ValueError('RESET_PATH_INVALID')
    if any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('RESET_SOURCE_SYMLINK')
    staging = backup.with_name(backup.name + '.new')
    staging.mkdir(mode=0o700)
    original = source.stat()
    moved = []
    installed = []
    counts = {}
    try:
        inputs = source / 'reports' / 'inputs'
        if inputs.is_dir():
            shutil.copytree(inputs, staging / 'reports' / 'inputs')
        with closing(sqlite3.connect(f'file:{source / "aemr.db"}?mode=ro', uri=True)) as old:
            if old.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('RESET_SOURCE_DATABASE_INVALID')
            with closing(sqlite3.connect(staging / 'aemr.db')) as fresh:
                objects = old.execute("SELECT type,name,sql FROM sqlite_master "
                                      "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
                                      "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").fetchall()
                for _, _, sql in objects:
                    fresh.execute(sql)
                tables = {name for kind, name, _ in objects if kind == 'table'}
                for table in DECISIONS:
                    if table not in tables:
                        continue
                    rows = old.execute(f'SELECT * FROM "{table}"').fetchall()
                    counts[table] = len(rows)
                    if rows:
                        marks = ','.join('?' for _ in rows[0])
                        fresh.executemany(f'INSERT INTO "{table}" VALUES ({marks})', rows)
                fresh.commit()
                if fresh.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise ValueError('RESET_NEW_DATABASE_INVALID')
        # The old tree is kept byte for byte; no destructive delete precedes acceptance.
        for path in [staging, *staging.rglob('*')]:
            os.chown(path, original.st_uid, original.st_gid)
        backup.mkdir(mode=0o700)
        for path in list(source.iterdir()):
            path.rename(backup / path.name)
            moved.append(path.name)
        for path in list(staging.iterdir()):
            path.rename(source / path.name)
            installed.append(path.name)
        staging.rmdir()
    except BaseException:
        for name in reversed(installed):
            (source / name).rename(staging / name)
        for name in reversed(moved):
            (backup / name).rename(source / name)
        raise
    return {'status': 'CURRENT_STATE_RESET', 'preserved_decisions': counts,
            'old_state': str(backup), 'active_archives': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(reset_current(args.source, args.backup), sort_keys=True))
