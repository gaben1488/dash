import sqlite3
from contextlib import closing

import pytest
from procurement_engine.identity_store import IdentityStore


def test_corrupt_identity_database_is_rejected_before_use_or_backup(tmp_path):
    path = tmp_path / 'identity.sqlite'
    store = IdentityStore(path)
    with path.open('r+b') as file:
        file.write(b'not a sqlite db!')
    with pytest.raises(ValueError, match='IDENTITY_DATABASE_CORRUPT'):
        IdentityStore(path)
    with pytest.raises(ValueError, match='IDENTITY_DATABASE_CORRUPT'):
        store.backup(tmp_path / 'backup.sqlite')
    assert not (tmp_path / 'backup.sqlite').exists()


def test_backup_keeps_complete_overflow_pages_and_reopens_independently(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    with closing(store.connect()) as db, db:
        db.execute('INSERT INTO snapshots(snapshot_id,digest,captured_at,result) VALUES(?,?,?,?)',
                   ('synthetic', 'digest', '2026-09-30T00:00:00Z', 'x' * 6_000_000))
    backup = tmp_path / 'backup.sqlite'; store.backup(backup)
    with closing(sqlite3.connect(backup)) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        assert db.execute('SELECT length(result) FROM snapshots').fetchone() == (6_000_000,)
