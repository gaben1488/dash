"""Read-only first-compaction proof using the installed native publication reader."""
import hashlib
import json
import re
import sqlite3
import stat
import sys
from contextlib import closing
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


def compact_contract(original_root,original):
    files=json.loads(original[1]);receipt=json.loads(original[0])
    require(original_root.is_dir() and not original_root.is_symlink()
            and not (original_root/'snapshot_bundle').is_symlink())
    def witness(name):
        path=original_root/name;require(stat.S_ISREG(path.lstat().st_mode))
        body=path.read_bytes();require(hashlib.sha256(body).hexdigest()==files.get(name))
        return json.loads(body)
    model=witness('report_model.json')
    expected_receipt={**receipt,'replay_available':False,'report_year':model['snapshot']['report_year'],
                      'quarter':model['headline']['current_quarter']}
    del model
    names={'dashboard.json','main_report.docx','management_report.docx','operational_report.docx','identity.sqlite'}
    expected_files={name:value for name,value in files.items() if name in names}
    manifest=witness('snapshot_bundle/manifest.json')
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
    with store.reader_lease(),closing(sqlite3.connect(store.database_path.as_uri()+'?mode=ro',uri=True)) as catalog, \
         closing(sqlite3.connect((work/'entries.sqlite').absolute().as_uri()+'?mode=ro',uri=True)) as journal:
        catalog.execute('PRAGMA query_only=ON');journal.execute('PRAGMA query_only=ON')
        require(journal.execute('PRAGMA quick_check').fetchone()==('ok',))
        require({row[0] for row in journal.execute('SELECT release_id FROM entries')}==targets)
        # Sort identifiers only. Large receipt JSON never enters a SQLite sorter.
        ordered=[row[0] for row in catalog.execute('SELECT release_id FROM publications ORDER BY report_date DESC,cutoff_at DESC,release_id DESC') if row[0] in expected]
        require(set(ordered)==expected)
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
            for name in json.loads(row[-1]):
                if name in {'main_report.docx','management_report.docx','operational_report.docx'}:
                    require(store.read_artifact(rid,name).startswith(b'PK\x03\x04'));counts['word_artifacts']+=1
                elif name=='dashboard.json':
                    require(isinstance(json.loads(store.read_artifact(rid,name)),dict));counts['dashboard_artifacts']+=1
            if item is not None:row[-2:]=item['original']
            if ordinal:revision.update(b',')
            encode(row);counts['verified_roots']+=1
        revision.update(b'],');encode(sorted(keep));revision.update(b',');encode(sorted(targets));revision.update(b']')
        require(revision.hexdigest()==plan['catalog_revision'] and marker_path.read_bytes()==marker_body)
    return counts


if __name__=='__main__':
    try:print(json.dumps(verify(Path(sys.argv[1]),json.load(sys.stdin)),sort_keys=True))
    except Exception:  # noqa: BLE001 - fixed public code; private paths and payload never escape
        raise SystemExit('RETAINED_STATE_READBACK_FAILED') from None
