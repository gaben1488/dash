"""Replay the exact trusted99-row revision, without constructing another plan."""
import json
import re
import resource
import sqlite3
import time
import tracemalloc
from contextlib import closing
from pathlib import Path


def reference_ids(reference):
    keep=reference['keep_release_ids'];targets=reference['retire_release_ids']
    ids=keep+targets
    if (not 0<len(ids)<=256 or len(set(ids))!=len(ids)
            or any(not isinstance(value,str) or not re.fullmatch('REL-[a-f0-9]{64}',value) for value in ids)
            or not re.fullmatch('[a-f0-9]{64}',reference['catalog_revision'])):
        raise ValueError('REFERENCE_INVALID')
    return ids


def revision_summary(database, reference, revision):
    ids=reference_ids(reference)
    keep=reference['keep_release_ids'];targets=reference['retire_release_ids']
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


def identity_gap_summary(state,reference):
    reference_ids(reference)
    targets=reference['retire_release_ids']
    if not targets:return {'target_snapshots':0,'missing_signatures':0,'missing_snapshots':0},[]
    deadline=time.monotonic()+150
    def reader(path):
        db=sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True,timeout=1)
        db.execute('PRAGMA query_only=ON')
        db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
        db.execute('BEGIN')
        return db
    with closing(reader(Path(state)/'published/publications.sqlite')) as db:
        mapping=db.execute('SELECT release_id,json_extract(receipt,\'$.snapshot_id\') FROM publications WHERE release_id IN ('+
                           ','.join('?' for _ in targets)+')',targets).fetchall()
    if len(mapping)!=len(targets) or any(not isinstance(sid,str) or not sid for _,sid in mapping):
        raise ValueError('TARGET_SNAPSHOT_REFERENCE_MISSING')
    snapshots=sorted({sid for _,sid in mapping})
    private=[]
    with closing(reader(Path(state)/'identity.sqlite')) as db:
        for sid in snapshots:
            count,plan,entity=db.execute('SELECT count(*),sum(plan_signature IS NULL),sum(entity_signature IS NULL) '
                                        'FROM observations WHERE snapshot_id=?',(sid,)).fetchone()
            if not count or plan or entity:
                private.append({'snapshot_id':sid,'release_ids':[rid for rid,snapshot in mapping if snapshot==sid],
                                'observations':count,'missing_plan':plan or 0,'missing_entity':entity or 0})
    return {'target_snapshots':len(snapshots),'affected_snapshots':len(private),
            'missing_plan':sum(v['missing_plan'] for v in private),'missing_entity':sum(v['missing_entity'] for v in private),
            'missing_snapshots':sum(v['observations']==0 for v in private),'atomic':False},private


def backup_coverage_summary(database,reference,manifest):
    reference_ids(reference)
    targets=reference['retire_release_ids'];covered=missing=mismatched=0
    with closing(sqlite3.connect(Path(database).absolute().as_uri()+'?mode=ro',uri=True,timeout=1)) as db:
        db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        for rid in targets:
            row=db.execute('SELECT files FROM publications WHERE release_id=?',(rid,)).fetchone()
            if row is None:raise ValueError('REFERENCE_ROWS_MISSING')
            current=json.loads(row[0]);prefix='reports/published/releases/'+rid+'/'
            saved={name[len(prefix):]:item['sha256'] for name,item in manifest['files'].items()
                   if name.startswith(prefix) and item.get('kind') in (None,'file')}
            if not saved:missing+=1
            elif saved!=current:mismatched+=1
            else:covered+=1
    # Preliminary index comparison, not archive re-verification or live-file proof.
    return {'target_roots':len(targets),'covered_roots':covered,'missing_roots':missing,
            'mismatched_roots':mismatched,'catalog_hashes_only':True}


if __name__=='__main__':
    import sys
    # The authenticated job prepends the actual reviewed function from exact
    # main1666 source. This diagnostic does not maintain a copy of its logic.
    method=globals()['_catalog_revision']
    reference=json.loads(Path('/reference.json').read_text())
    if sys.argv[1]=='identity':
        summary,private=identity_gap_summary('/app/packages/server/data/reports',reference)
        print(json.dumps({'identity_signature_gaps':summary,'private_signature_gaps':private},sort_keys=True))
    elif sys.argv[1]=='coverage':
        print(json.dumps({'backup_root_index_coverage':backup_coverage_summary(
            '/app/packages/server/data/reports/published/publications.sqlite',reference,
            json.loads(Path('/backup-manifest.json').read_bytes()))},sort_keys=True))
    else:
        print(json.dumps({'publication_revision_replay':revision_summary(
            '/app/packages/server/data/reports/published/publications.sqlite',reference,method)},sort_keys=True))
