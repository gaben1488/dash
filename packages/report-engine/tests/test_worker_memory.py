"""Exercise retained evidence in a memory-bounded process, without live services."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ADDITIONAL_MEMORY = 96 * 1024 * 1024
ATTEMPTS = 687


def _digest(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        for part in iter(lambda: file.read(1024 * 1024), b''):
            value.update(part)
    return value.hexdigest()


def _bundle(root):
    # Write incrementally so fixture creation does not consume the tested budget.
    root.mkdir()
    row = json.dumps(['synthetic-cell-xxxxxxxxxxxxxxxxx'] * 8, separators=(',', ':')).encode()
    entries = []
    for index in range(2):
        path = root / f'payload-{index}.json'
        semantic = hashlib.sha256(b'[')
        with path.open('wb') as file:
            file.write(b'{"semantic_values":[')
            for number in range(50000):
                part = (b',' if number else b'') + row
                file.write(part)
                semantic.update(part)
            file.write(b']}')
        semantic.update(b']')
        entries.append({'source_id': str(index), 'path': path.name,
                        'bundle_file_sha256': _digest(path), 'canonical_semantic_hash': semantic.hexdigest()})
    manifest = root / 'manifest.json'
    manifest.write_text(json.dumps({'snapshot_id': 'synthetic', 'payload_index': entries}))
    (root / 'bundle.json').write_text(json.dumps({'snapshot_id': 'synthetic', 'manifest_sha256': _digest(manifest)}))


def _statuses(root):
    for index in reversed(range(ATTEMPTS)):
        # Match the observed attempt count/max status, with smaller other files
        # to bound CI disk traffic. The aggregate still exceeds the RAM budget.
        evidence = 'x' * (5_356_000 if index == ATTEMPTS - 1 else 128 * 1024)
        name = f'attempt-{index:03}'
        folder = root / 'attempts' / name
        folder.mkdir(parents=True)
        status = {'attempt_id': name, 'report_date': '28.09.2034' if index < 343 else '05.10.2034',
                  'snapshot_id': f'SNP-{index}', 'finished_at': f'2034-10-05T{max(index - 1, 0) // 60:02}:{max(index - 1, 0) % 60:02}:00Z',
                  'publication': {'release_id': f'REL-{index}', 'automation_assurance': evidence},
                  'automation_assurance': evidence}
        (folder / 'status.json').write_text(json.dumps(status))
        (folder / 'capture.json').write_text('capture')
        (folder / 'error.json').write_text('audit error')


def _child(case, root):
    import resource
    if case == 'bundle':
        from procurement_engine import snapshot_bundle_io
    elif case == 'weekly':
        from procurement_engine import weekly_archive
    else:
        from procurement_engine.retention import (
            apply_transient_attempt_retention,
            plan_transient_attempt_retention,
        )

    # Bound processing allocations independently of the interpreter/import baseline.
    initial = int(Path('/proc/self/statm').read_text().split()[0]) * resource.getpagesize()
    limit = initial + ADDITIONAL_MEMORY
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    if case == 'bundle':
        assert snapshot_bundle_io.verify_persisted_bundle(root) == []
        # The bounded path still rejects a changed file; no integrity checks relax.
        with (root / 'payload-1.json').open('ab') as file:
            file.write(b' ')
        assert snapshot_bundle_io.verify_persisted_bundle(root) == ['SNAPSHOT_PAYLOAD_FILE_HASH_MISMATCH:1']
    elif case == 'weekly':
        calls = []
        def seal(_state, status):
            calls.append((status['attempt_id'], status['snapshot_id'], status['publication']['release_id']))
            return {'status': 'NOT_READY' if status['attempt_id'] == 'attempt-000' else
                    'ALREADY_SEALED' if status['attempt_id'] == 'attempt-343' else 'SEALED'}
        weekly_archive.maybe_seal_weekly_archive = seal
        result = weekly_archive.recover_weekly_archives(root)
        assert [item['status'] for item in result] == ['NOT_READY', 'SEALED', 'ALREADY_SEALED']
        assert calls == [('attempt-000', 'SNP-0', 'REL-0'), ('attempt-001', 'SNP-1', 'REL-1'),
                         ('attempt-343', 'SNP-343', 'REL-343')]
    elif case == 'retention':
        # Every Thursday remains protected until sealed, including old duplicates.
        protected = plan_transient_attempt_retention(root)
        assert protected['protected_unsealed_thursdays'] == ATTEMPTS
        assert protected['compact_count'] == 0
        # Keep current/newest status bytes; older evidence becomes a bounded summary.
        for path in root.glob('attempts/*/status.json'):
            value = json.loads(path.read_text())
            value['report_date'] = '07.10.2034'
            path.write_text(json.dumps(value))
        before = {path: _digest(path) for path in root.glob('attempts/*/status.json')}
        (root / 'status.json').write_text('{"attempt_id":"attempt-000"}')
        plan = plan_transient_attempt_retention(root)
        assert plan['compact_attempts'] == [f'attempt-{i:03}' for i in range(1, ATTEMPTS - 2)]
        applied = apply_transient_attempt_retention(root, expected_attempts=plan['compact_attempts'])
        assert applied['compacted'] == ATTEMPTS - 3
        for path, digest in before.items():
            index = int(path.parent.name.removeprefix('attempt-'))
            if index in (0, ATTEMPTS - 2, ATTEMPTS - 1):
                assert _digest(path) == digest
            else:
                value = json.loads(path.read_text())
                assert value['snapshot_id'] == f'SNP-{index}'
                assert value['report_date'] == '07.10.2034'
                assert value['publication'] == {'release_id': f'REL-{index}'}
                assert 'automation_assurance' not in value
                assert path.stat().st_size < 1024
        assert all((path.parent / 'error.json').read_text() == 'audit error' for path in before)
    print('BOUNDED_EVIDENCE_PASS')


@pytest.mark.parametrize('case', ['bundle', 'weekly', 'retention'])
def test_worker_evidence_processing_is_bounded_and_preserves_checks(tmp_path, case):
    root = tmp_path / case
    if case == 'bundle':
        _bundle(root)
    else:
        _statuses(root)
    source = str(Path(__file__).resolve().parents[1] / 'src')
    result = subprocess.run([sys.executable, str(Path(__file__).resolve()), case, str(root)],
                            env={**os.environ, 'PYTHONPATH': source}, capture_output=True,
                            text=True, timeout=30, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == 'BOUNDED_EVIDENCE_PASS'


if __name__ == '__main__':
    _child(sys.argv[1], Path(sys.argv[2]))
