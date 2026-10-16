"""Read-only first-compaction proof using the installed native publication reader."""
import hashlib
import json
import re
import sqlite3
import stat
import sys
from contextlib import ExitStack, closing
from pathlib import Path


def require(value):
    if not value:raise ValueError('RETAINED_STATE_READBACK_FAILED')


def digest(path):
    info=path.lstat()
    require(stat.S_ISREG(info.st_mode))
    result=hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()


def verified_views(store,rid,files,counts,*,sample):
    # _checked already hashed every file in this immutable root. Calling the
    # download route for every file repeats that full scan for every view.
    for name in files:
        path=store.releases/rid/name
        if name in {'main_report.docx','management_report.docx','operational_report.docx'}:
            if sample:require(store.read_artifact(rid,name).startswith(b'PK\x03\x04'))
            else:
                with path.open('rb') as source:require(source.read(4)==b'PK\x03\x04')
            counts['word_artifacts']+=1
        elif name=='dashboard.json':
            body=store.read_artifact(rid,name) if sample else path.read_bytes()
            require(isinstance(json.loads(body),dict));counts['dashboard_artifacts']+=1


def compact_contract(original_root,original):
    files=json.loads(original[1]);receipt=json.loads(original[0])
    require(original_root.is_dir() and not original_root.is_symlink()
            and not (original_root/'snapshot_bundle').is_symlink())
    def witness(name):
        path=original_root/name;require(stat.S_ISREG(path.lstat().st_mode))
        body=path.read_bytes();require(hashlib.sha256(body).hexdigest()==files.get(name))
        return json.loads(body)
    manifest=witness('snapshot_bundle/manifest.json')
    dashboard=witness('dashboard.json')
    # Publication already verified these exact projection/snapshot fields
    # against the model. Preserve context without parsing the large model again.
    expected_receipt={**receipt,'replay_available':False,'report_year':manifest['report_year'],
                      'quarter':dashboard['headline']['current_quarter']}
    names={'dashboard.json','main_report.docx','management_report.docx','operational_report.docx','identity.sqlite'}
    expected_files={name:value for name,value in files.items() if name in names}
    roles={source['source_id']:source.get('role') for source in manifest.get('sources',[])}
    for item in manifest.get('payload_index',[]):
        if roles.get(item['source_id']) in {'historical_ledger','historical_report_evidence','identity_reviews','rule_contract'}:
            path=Path(item['path']);require(not path.is_absolute() and '..' not in path.parts)
            expected_files['retained_evidence/'+path.as_posix()]=files['snapshot_bundle/'+path.as_posix()]
    if any(name.startswith('retained_evidence/') for name in expected_files):
        expected_files['retained_evidence/source_manifest.json']=files['snapshot_bundle/manifest.json']
    return expected_receipt,expected_files


def verify(state,plan):
    from procurement_engine.publication_store import PublicationStore
    from procurement_engine.readonly_catalog import copied_catalog

    keep=set(plan['keep_release_ids']);targets=set(plan['retire_release_ids']);expected=keep|targets
    require(not keep&targets and len(expected)==plan['publication_count']
            and all(re.fullmatch('REL-[a-f0-9]{64}',rid) for rid in expected))
    root=Path(state)/'published';work=root/'.retirement';marker_path=work/'journal.json'
    require(not work.is_symlink() and not marker_path.is_symlink())
    marker_body=marker_path.read_bytes();marker=json.loads(marker_body)
    require(marker.get('contract')=='publication-compaction-v2' and marker.get('readers_ready') is True
            and not marker.get('rollback_requested') and not marker.get('finalizing')
            and marker.get('plan_revision')==plan['catalog_revision']
            and marker.get('entry_count')==len(targets)
            and digest(work/'entries.sqlite')==marker.get('entries_sha256'))
    store=PublicationStore(root,readonly=True)
    encoder=json.JSONEncoder(separators=(',',':'))
    revision=hashlib.sha256();revision.update(b'[[')
    def encode(value):
        for chunk in encoder.iterencode(value):revision.update(chunk.encode())
    counts={'status':'RETAINED_STATE_VERIFIED','verified_roots':0,'compacted_roots':len(targets),
            'protected_roots':len(keep),'word_artifacts':0,'dashboard_artifacts':0,'original_catalog_equivalent':True}
    require(not store.database_path.is_symlink())
    with ExitStack() as stack:
        stack.enter_context(store.reader_lease())
        # Same native byte-stable DB+WAL barrier; only private disk scratch is
        # writable. A read-only WAL mount may lack writable SQLite shared memory.
        store.database_path=stack.enter_context(copied_catalog(store.database_path))
        catalog=stack.enter_context(closing(sqlite3.connect(store.database_path.as_uri()+'?mode=ro',uri=True)))
        journal=stack.enter_context(closing(sqlite3.connect((work/'entries.sqlite').absolute().as_uri()+'?mode=ro',uri=True)))
        catalog.execute('PRAGMA query_only=ON');journal.execute('PRAGMA query_only=ON')
        require(journal.execute('PRAGMA quick_check').fetchone()==('ok',))
        require({row[0] for row in journal.execute('SELECT release_id FROM entries')}==targets)
        # Sort identifiers only. Large receipt JSON never enters a SQLite sorter.
        ordered=[row[0] for row in catalog.execute('SELECT release_id FROM publications ORDER BY report_date DESC,cutoff_at DESC,release_id DESC') if row[0] in expected]
        require(set(ordered)==expected)
        sampled=set()
        for ordinal,rid in enumerate(ordered):
            row=list(catalog.execute('SELECT release_id,report_date,cutoff_at,receipt,files FROM publications WHERE release_id=?',(rid,)).fetchone())
            receipt=store._checked(row[-2:])
            require(receipt['release_id']==rid)
            item=None
            if rid in targets:
                item=json.loads(journal.execute('SELECT payload FROM entries WHERE release_id=?',(rid,)).fetchone()[0])
                require(item['release_id']==rid and item['compact']==row[-2:])
                expected_receipt,expected_files=compact_contract(work/'original'/rid,item['original'])
                require(receipt==expected_receipt and json.loads(row[-1])==expected_files)
            sample=(rid in targets) not in sampled
            sampled.add(rid in targets)
            verified_views(store,rid,json.loads(row[-1]),counts,sample=sample)
            if item is not None:row[-2:]=item['original']
            if ordinal:revision.update(b',')
            encode(row);counts['verified_roots']+=1
            if counts['verified_roots']%10==0:print(json.dumps({'retained_readback_roots':counts['verified_roots']}),file=sys.stderr,flush=True)
        revision.update(b'],');encode(sorted(keep));revision.update(b',');encode(sorted(targets));revision.update(b']')
        require(revision.hexdigest()==plan['catalog_revision'] and marker_path.read_bytes()==marker_body)
    counts['journal_sha256']=digest(work/'entries.sqlite')
    require(counts['journal_sha256']==marker['entries_sha256'])
    counts['marker_sha256']=hashlib.sha256(marker_body).hexdigest()
    return counts


def verify_finalized(state,plan):
    """Read every frozen target through the installed reader after disposal."""
    from procurement_engine.publication_store import PublicationStore
    from procurement_engine.readonly_catalog import copied_catalog

    keep=set(plan['keep_release_ids']);targets=set(plan['retire_release_ids']);expected=keep|targets
    require(not keep&targets and len(expected)==plan['publication_count']
            and all(re.fullmatch('REL-[a-f0-9]{64}',rid) for rid in expected))
    store=PublicationStore(Path(state)/'published',readonly=True)
    work=store.root/'.retirement';require(not work.exists() and not work.is_symlink())
    require(not store.database_path.is_symlink())
    result={'status':'FINALIZED_RETAINED_STATE_VERIFIED','verified_roots':0,'compacted_roots':len(targets),
            'protected_roots':len(keep),'word_artifacts':0,'dashboard_artifacts':0,'retained_files_verified':True}
    with ExitStack() as stack:
        stack.enter_context(store.reader_lease())
        store.database_path=stack.enter_context(copied_catalog(store.database_path))
        db=stack.enter_context(closing(sqlite3.connect(store.database_path.as_uri()+'?mode=ro',uri=True)))
        db.execute('PRAGMA query_only=ON')
        require(expected<={r[0] for r in db.execute('SELECT release_id FROM publications')})
        sampled=set()
        for rid in sorted(expected):
            pair=db.execute('SELECT receipt,files FROM publications WHERE release_id=?',(rid,)).fetchone()
            receipt=store._checked(pair);files=json.loads(pair[1])
            require(receipt['release_id']==rid)
            if rid in targets:
                require(receipt.get('replay_available') is False and 'report_model.json' not in files
                        and not any(name.startswith('snapshot_bundle/') for name in files))
            else:
                require(receipt.get('replay_available',True) is True and 'report_model.json' in files
                        and 'snapshot_bundle/manifest.json' in files)
            sample=(rid in targets) not in sampled
            sampled.add(rid in targets)
            verified_views(store,rid,files,result,sample=sample)
            result['verified_roots']+=1
        require(not work.exists() and not work.is_symlink())
    counts=plan['_expected_artifacts']
    require(set(counts)=={'word_artifacts','dashboard_artifacts'}
            and all(type(counts[k]) is int and result[k]==counts[k] for k in counts))
    return result


if __name__=='__main__':
    try:
        planned=json.load(sys.stdin)
        method=verify_finalized if planned.pop('_finalized_readback',False) is True else verify
        print(json.dumps(method(Path(sys.argv[1]),planned),sort_keys=True))
    except Exception:  # noqa: BLE001 - fixed public code; private paths and payload never escape
        raise SystemExit('RETAINED_STATE_READBACK_FAILED') from None
