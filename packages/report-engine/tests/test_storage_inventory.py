import hashlib
import json
import os
import sqlite3

from procurement_engine.storage_inventory import inventory_state


def fixture(root):
    releases = root / 'reports/published/releases'
    content = b'PRIVATE ROW CONTENT' * 100
    digest = hashlib.sha256(content).hexdigest()
    for i in range(3):
        folder = releases / ('REL-' + str(i) * 64)
        folder.mkdir(parents=True)
        if i == 2:
            os.link(releases / ('REL-' + '0' * 64) / 'payload.json', folder / 'payload.json')
        else:
            (folder / 'payload.json').write_bytes(content)
    with sqlite3.connect(root / 'reports/published/publications.sqlite') as db:
        db.execute('CREATE TABLE publications(release_id TEXT, files TEXT)')
        db.executemany('INSERT INTO publications VALUES (?, ?)', [
            ('REL-' + str(i) * 64, json.dumps({'payload.json': digest})) for i in range(3)])
    return len(content)


def test_distinguishes_duplicate_bytes_from_existing_links_without_exposing_content(tmp_path):
    size = fixture(tmp_path)
    result = inventory_state(tmp_path)
    assert result['catalog_claimed_duplicate_bytes'] == size
    assert result['verified_duplicate_bytes'] == size
    assert result['verified_groups'] == 1
    assert result['verification_complete'] is True
    assert 'PRIVATE' not in json.dumps(result)
    assert 'REL-' not in json.dumps(result)
    assert 'payload.json' not in json.dumps(result)


def test_does_not_promote_catalog_hash_to_verified_bytes(tmp_path):
    fixture(tmp_path)
    (tmp_path / 'reports/published/releases' / ('REL-' + '1' * 64) / 'payload.json').write_bytes(b'X' * 1900)
    result = inventory_state(tmp_path)
    assert result['verified_duplicate_bytes'] == 0
    assert result['hash_mismatches'] == 1


def test_budget_marks_partial_verification_and_does_not_delete_files(tmp_path):
    size = fixture(tmp_path)
    result = inventory_state(tmp_path, max_hash_bytes=size)
    assert result['verification_complete'] is False
    assert result['verified_duplicate_bytes'] == 0
    assert len(list(tmp_path.rglob('payload.json'))) == 3


def test_does_not_follow_external_symlinks(tmp_path):
    fixture(tmp_path)
    os.symlink('/etc/passwd', tmp_path / 'outside')
    result = inventory_state(tmp_path)
    assert result['unsafe_entries'] == 1
    assert 'passwd' not in json.dumps(result)
