"""Read only committed, integrity-checked report artifacts; never use live rows."""
from __future__ import annotations

import json
from pathlib import Path

from .publication_store import PublicationError, PublicationStore


def read_publication(state_dir, view, release_id=None):
    state = Path(state_dir)
    root = state / 'published'
    exists = (root / 'publications.sqlite').is_file()
    store = PublicationStore(root, readonly=True) if exists else None
    if view == 'status':
        attempt_path = state / 'status.json'
        attempt = json.loads(attempt_path.read_text(encoding='utf-8')) if attempt_path.exists() else None
        result = {'latest': store.latest() if store else None, 'attempt': attempt}
        return json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
    if view not in {'dashboard', 'main', 'supplement'}:
        raise PublicationError('PUBLICATION_VIEW_INVALID')
    if store is None:
        raise PublicationError('PUBLICATION_NOT_FOUND')
    names = {'dashboard': 'dashboard.json', 'main': 'main_report.docx',
             'supplement': 'management_report.docx'}
    return store.read_artifact(release_id, names[view])
