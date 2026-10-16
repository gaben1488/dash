"""Replay the exact trusted99-row revision, without constructing another plan."""
import json
import re
import resource
import sqlite3
import time
import tracemalloc
from contextlib import closing
from pathlib import Path


def revision_summary(database, reference, revision):
    keep=reference['keep_release_ids'];targets=reference['retire_release_ids']
    ids=keep+targets
    if (not 0<len(ids)<=256 or len(set(ids))!=len(ids)
            or any(not isinstance(value,str) or not re.fullmatch('REL-[a-f0-9]{64}',value) for value in ids)
            or not re.fullmatch('[a-f0-9]{64}',reference['catalog_revision'])):
        raise ValueError('REFERENCE_INVALID')
    deadline=time.monotonic()+150
    with closing(sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro',uri=True,timeout=1)) as db:
        db.execute('PRAGMA query_only=ON')
        db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
        db.execute('BEGIN')
        names=db.execute('SELECT release_id FROM publications ORDER BY report_date DESC,cutoff_at DESC,release_id DESC')
        wanted=set(ids)
        # Sort only IDs, preserving the exact legacy ordering. Each immutable
        # row is fetched separately; no SQLite sorter sees receipt payloads.
        rows=[db.execute('SELECT release_id,report_date,cutoff_at,receipt,files FROM publications WHERE release_id=?',row).fetchone()
              for row in names if row[0] in wanted]
        if len(rows)!=len(ids):raise ValueError('REFERENCE_ROWS_MISSING')
        tracemalloc.start()
        try:
            result=revision(rows,keep,targets)
            _,peak=tracemalloc.get_traced_memory()
        finally:tracemalloc.stop()
        if result!=reference['catalog_revision']:raise ValueError('REFERENCE_DIGEST_CHANGED')
    return {'frozen_catalog_rows':len(rows),'reference_digest_matches':True,
            'serialization_peak_bytes':peak,'process_peak_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024}


if __name__=='__main__':
    # The authenticated job prepends the actual reviewed function from exact
    # main1666 source. This diagnostic does not maintain a copy of its logic.
    method=globals()['_catalog_revision']
    reference=json.loads(Path('/reference.json').read_text())
    print(json.dumps({'publication_revision_replay':revision_summary(
        '/app/packages/server/data/reports/published/publications.sqlite',reference,method)},sort_keys=True))
