import fcntl
import hashlib
import json

from procurement_engine.cli import main
from procurement_engine.publication_store import initialize_publication_readers


def stamp(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


def test_missing_legacy_lease_is_explicit_blocker_without_creating_it(tmp_path, capsys):
    state = tmp_path / 'reports'
    (state / 'published').mkdir(parents=True)
    (state / 'published' / 'catalog.sqlite').write_bytes(b'legacy catalog unchanged')
    before = stamp(state)
    assert main(['check-publication-readers', '--state', str(state)]) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['status'] == 'BLOCKED'
    assert result['error_code'] == 'PUBLICATION_READER_LEASE_UNINITIALIZED'
    assert result['required_action'] == 'AUTHORIZED_QUIESCENT_READER_BOOTSTRAP'
    assert stamp(state) == before
    assert not (state / 'publication-readers.lock').exists()


def test_initialized_lease_passes_without_replacing_or_writing_state(tmp_path, capsys):
    initialize_publication_readers(tmp_path)
    path = tmp_path / 'publication-readers.lock'
    inode, before = path.stat().st_ino, stamp(tmp_path)
    assert main(['check-publication-readers', '--state', str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)['status'] == 'PASS'
    assert path.stat().st_ino == inode
    assert stamp(tmp_path) == before


def test_active_maintenance_is_not_mislabelled_as_missing_bootstrap(tmp_path, capsys):
    initialize_publication_readers(tmp_path)
    with (tmp_path / 'publication-readers.lock').open('r') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert main(['check-publication-readers', '--state', str(tmp_path)]) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['error_code'] == 'PUBLICATION_MAINTENANCE_ACTIVE'
    assert result['required_action'] == 'RESOLVE_READER_LEASE_BLOCKER'


def test_recovery_required_keeps_its_own_failure_code_and_files(tmp_path, capsys):
    initialize_publication_readers(tmp_path)
    pending = tmp_path / 'published' / '.retirement'
    pending.mkdir(parents=True)
    (pending / 'journal.json').write_text('{"readers_ready":false}')
    before = stamp(tmp_path)
    assert main(['check-publication-readers', '--state', str(tmp_path)]) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['error_code'] == 'PUBLICATION_RETENTION_RECOVERY_REQUIRED'
    assert result['required_action'] == 'RESOLVE_READER_LEASE_BLOCKER'
    assert stamp(tmp_path) == before


def test_absent_state_never_gets_created_by_preflight(tmp_path, capsys):
    state = tmp_path / 'absent'
    assert main(['check-publication-readers', '--state', str(state)]) == 2
    assert not state.exists()
    assert json.loads(capsys.readouterr().out)['status'] == 'BLOCKED'
