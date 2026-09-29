"""Read only committed, integrity-checked report artifacts; never use live rows."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .publication_store import PublicationError, PublicationStore


def read_publication(state_dir, view, release_id=None, *, selection=None):
    if selection is not None:
        try:
            day, year, quarter = selection
            if (view != 'status' or release_id is not None or date.fromisoformat(day).isoformat() != day
                    or type(year) is not int or not 1900 <= year <= 9999
                    or type(quarter) is not int or quarter not in (1, 2, 3, 4)):
                raise ValueError('invalid selection')
        except (TypeError, ValueError) as exc:
            raise PublicationError('PUBLICATION_CONTEXT_INVALID') from exc
    state = Path(state_dir)
    root = state / 'published'
    exists = (root / 'publications.sqlite').is_file()
    store = PublicationStore(root, readonly=True) if exists else None
    if view == 'status':
        attempt_path = state / 'status.json'
        attempt = json.loads(attempt_path.read_text(encoding='utf-8')) if attempt_path.exists() else None
        if selection is not None:
            result = {'selected': store.select(*selection) if store else None, 'attempt': attempt}
        else:
            result = {'latest': store.latest() if store else None, 'attempt': attempt}
        return json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
    if view not in {'dashboard', 'main', 'supplement'}:
        raise PublicationError('PUBLICATION_VIEW_INVALID')
    if store is None:
        raise PublicationError('PUBLICATION_NOT_FOUND')
    names = {'dashboard': 'dashboard.json', 'main': 'main_report.docx',
             'supplement': 'management_report.docx'}
    return store.read_artifact(release_id, names[view])
