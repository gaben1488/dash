import importlib.util
import sqlite3
from contextlib import closing
from pathlib import Path


def test_fresh_start_preserves_answers_and_inputs_but_no_history(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('reset_current', Path(__file__).parents[1] / 'reset-current-state.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path / 'active'
    source.mkdir()
    inputs = source / 'reports' / 'inputs'
    inputs.mkdir(parents=True)
    (inputs / 'registry.json').write_text('{"current":true}')
    (source / 'reports' / 'archives').mkdir()
    (source / 'reports' / 'archives' / 'old').write_bytes(b'old evidence')
    with closing(sqlite3.connect(source / 'aemr.db')) as db:
        db.executescript('CREATE TABLE snapshots(id TEXT); INSERT INTO snapshots VALUES ("old");'
                         'CREATE TABLE yearlong_kind_overrides(id INTEGER,kind TEXT);'
                         'INSERT INTO yearlong_kind_overrides VALUES (1,"contract-series");')
        db.commit()
    backup = tmp_path / 'rollback'
    # chown is unsupported on Windows; production uses the original Linux owner.
    if not hasattr(module.os, 'chown'):
        monkeypatch.setattr(module.os, 'chown', lambda *_: None, raising=False)
    result = module.reset_current(source, backup)
    with closing(sqlite3.connect(source / 'aemr.db')) as db:
        assert db.execute('SELECT * FROM snapshots').fetchall() == []
        assert db.execute('SELECT kind FROM yearlong_kind_overrides').fetchall() == [('contract-series',)]
    assert not (source / 'reports' / 'archives').exists()
    assert (backup / 'reports' / 'archives' / 'old').read_bytes() == b'old evidence'
    assert (inputs / 'registry.json').read_text() == '{"current":true}'
    assert result['preserved_decisions'] == {'yearlong_kind_overrides': 1}
