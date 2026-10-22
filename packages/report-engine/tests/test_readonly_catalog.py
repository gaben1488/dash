import hashlib
import sqlite3
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

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


def test_insufficient_selected_scratch_fails_before_copying(tmp_path, monkeypatch):
    from procurement_engine import readonly_catalog as module
    path = tmp_path / 'catalog.sqlite'
    with closing(sqlite3.connect(path)) as db:
        db.execute('CREATE TABLE t(a)')
    before = fingerprints(tmp_path)
    selected = []
    def disk_usage(folder):
        selected.append(folder)
        return SimpleNamespace(free=0)
    monkeypatch.setattr(module.shutil, 'disk_usage', disk_usage)
    copied = []
    original = module.shutil.copyfile
    def copyfile(*args):
        copied.append(args)
        return original(*args)
    monkeypatch.setattr(module.shutil, 'copyfile', copyfile)
    with pytest.raises(ValueError, match='PUBLICATION_CATALOG_SCRATCH_INSUFFICIENT'), copied_catalog(path):
        pytest.fail('A catalog cannot be admitted into an undersized tmpfs')
    assert selected and not copied
    assert fingerprints(tmp_path) == before
    assert all(not Path(folder).exists() for folder in selected)


def test_temporary_copy_is_removed_when_reader_fails(tmp_path):
    path = tmp_path / 'catalog.sqlite'
    with closing(sqlite3.connect(path)) as db:
        db.execute('CREATE TABLE t(a)')
    before = fingerprints(tmp_path)
    with pytest.raises(RuntimeError, match='reader failed'), copied_catalog(path) as copy:
        assert copy.exists()
        raise RuntimeError('reader failed')
    assert not copy.exists()
    assert fingerprints(tmp_path) == before
