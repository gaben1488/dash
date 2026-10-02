import hashlib
import sqlite3
from contextlib import closing

import pytest
from procurement_engine.readonly_catalog import copied_catalog


def fingerprints(root):
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir() if p.is_file()}


def test_committed_wal_is_included_and_source_remains_unchanged(tmp_path):
    path = tmp_path / 'catalog.sqlite'
    with closing(sqlite3.connect(path)) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE records(value)'); db.commit()
        db.execute('INSERT INTO records VALUES (?)', ('WAL-only',)); db.commit()
        assert path.with_name(path.name + '-wal').exists()
        before = fingerprints(tmp_path)
        with copied_catalog(path) as copy, closing(sqlite3.connect(copy)) as clone:
            assert clone.execute('SELECT value FROM records').fetchall() == [('WAL-only',)]
        assert fingerprints(tmp_path) == before
        assert not copy.exists()


def test_moving_source_does_not_become_a_successful_rehearsal(tmp_path, monkeypatch):
    from procurement_engine import readonly_catalog as module
    path = tmp_path / 'catalog.sqlite'
    with closing(sqlite3.connect(path)) as db:
        db.execute('CREATE TABLE t(a)')
    original = module._stamp
    calls = 0
    def moving(file):
        nonlocal calls
        stamp = original(file)
        calls += 1
        return (*stamp, calls) if stamp else None
    monkeypatch.setattr(module, '_stamp', moving)
    with pytest.raises(ValueError, match='CHANGED_DURING_COPY'), copied_catalog(path):
        pytest.fail('A moving source must never be accepted')


def test_missing_catalog_never_creates_a_production_database(tmp_path):
    with pytest.raises(ValueError, match='PUBLICATION_NOT_FOUND'), copied_catalog(tmp_path / 'missing'):
        pytest.fail()
    assert not list(tmp_path.iterdir())
