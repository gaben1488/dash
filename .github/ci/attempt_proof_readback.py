"""Fixed, externally admitted readback of one attributed terminal attempt."""
from __future__ import annotations

import hashlib
import json
import re

MAX_BYTES = 32*1024*1024


def expected_status_hash(status):
    digest, size = hashlib.sha256(), 0
    for part in json.JSONEncoder(ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).iterencode(status):
        encoded = part.encode(); size += len(encoded)
        if size > MAX_BYTES:
            raise ValueError('ATTEMPT_PROOF_READBACK_INVALID')
        digest.update(encoded)
    return digest.hexdigest()


def _eligible(status):
    publication = status.get('publication')
    return (status.get('reused_publication') is True
        and status.get('status') in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
        and 'automation_assurance' not in status and isinstance(publication, dict)
        and publication.get('status') == status['status']
        and bool(status.get('snapshot_id')) and status['snapshot_id'] == publication.get('snapshot_id')
        and isinstance(publication.get('model_sha256'), str)
        and re.fullmatch(r'[a-f0-9]{64}', publication['model_sha256']) is not None
        and publication.get('release_id') == 'REL-' + publication['model_sha256']
        and 'automation_assurance_ref' not in publication
        and isinstance(publication.get('automation_assurance'), dict))


# Standalone program: no source override, writes, network, subprocesses or catalog bootstrap.
NATIVE_PROGRAM = r'''
import hashlib,json,os,re,stat,sys
from pathlib import Path
STATE = Path('/app/packages/server/data/reports')
MAX_BYTES = 32*1024*1024

def canonical(value):
    digest,size=hashlib.sha256(),0
    for part in json.JSONEncoder(ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).iterencode(value):
        encoded=part.encode();size+=len(encoded)
        if size>MAX_BYTES:raise ValueError('BOUND')
        digest.update(encoded)
    return digest.hexdigest()

def signature(info):
    return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_uid,info.st_gid,info.st_mode,info.st_nlink)

def read_private(path):
    if any(part.is_symlink() for part in (path,*path.parents)):raise ValueError('PATH')
    before=path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_uid!=1000 or before.st_nlink!=1
            or before.st_mode&0o022 or not 0<before.st_size<=MAX_BYTES):raise ValueError('FILE')
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(descriptor,'rb') as stream:
        if signature(os.fstat(stream.fileno()))!=signature(before):raise ValueError('CHANGED')
        body=stream.read(MAX_BYTES+1)
        if len(body)>MAX_BYTES:raise ValueError('BOUND')
        value=json.loads(body)
        if signature(os.fstat(stream.fileno()))!=signature(before):raise ValueError('CHANGED')
    if signature(path.lstat())!=signature(before):raise ValueError('CHANGED')
    if not isinstance(value,dict):raise ValueError('SHAPE')
    return value,len(body),signature(before)

def eligible(status):
    publication=status.get('publication')
    return (status.get('reused_publication') is True
        and status.get('status') in {'VERIFIED','VERIFIED_WITH_WARNINGS'}
        and 'automation_assurance' not in status and isinstance(publication,dict)
        and publication.get('status')==status['status']
        and bool(status.get('snapshot_id')) and status['snapshot_id']==publication.get('snapshot_id')
        and isinstance(publication.get('model_sha256'),str)
        and re.fullmatch(r'[a-f0-9]{64}',publication['model_sha256']) is not None
        and publication.get('release_id')=='REL-'+publication['model_sha256']
        and 'automation_assurance_ref' not in publication
        and isinstance(publication.get('automation_assurance'),dict))

def main():
    if os.geteuid()!=1000 or len(sys.argv)!=3:raise ValueError('INVOCATION')
    identity,expected=sys.argv[1:]
    if not re.fullmatch(r'[a-f0-9]{32}',identity) or not re.fullmatch(r'[a-f0-9]{64}',expected):raise ValueError('ARGUMENT')
    path=STATE/'attempts'/identity/'status.json'
    retained,retained_bytes,before=read_private(path)
    if retained.get('attempt_id')!=identity:raise ValueError('IDENTITY')
    from procurement_engine.publication_store import PublicationStore
    restored=PublicationStore(STATE/'published',readonly=True).read_attempt(identity)
    if (not isinstance(restored,dict) or restored.get('attempt_id')!=identity
            or canonical(restored)!=expected):raise ValueError('PROOF')
    observed=eligible(restored)
    publication=retained.get('publication')
    reference=publication.get('automation_assurance_ref') if isinstance(publication,dict) else None
    if observed:
        original=restored['publication']
        if (not isinstance(reference,dict) or set(reference)!={'release_id','content_sha256'}
                or reference['release_id']!=original['release_id']
                or reference['content_sha256']!=canonical(original['automation_assurance'])
                or 'automation_assurance' in publication):raise ValueError('REFERENCE')
        hydrated={**retained,'publication':{**{key:value for key,value in publication.items() if key!='automation_assurance_ref'},
                                          'automation_assurance':original['automation_assurance']}}
        if hydrated!=restored:raise ValueError('METADATA')
        current,current_bytes,_=read_private(STATE/'status.json')
        if canonical(current)!=expected or not eligible(current):raise ValueError('GLOBAL')
    else:
        if reference is not None or (isinstance(publication,dict) and 'automation_assurance_ref' in publication):raise ValueError('REFERENCE')
        if retained!=restored:raise ValueError('INLINE')
        current_bytes=None
    if signature(path.lstat())!=before:raise ValueError('CHANGED')
    return {'scope':'SINGLE_RETAINED_ATTEMPT','format':'REFERENCE' if observed else 'INLINE',
            'coverage':'OBSERVED' if observed else 'NOT_OBSERVED','proof_matches':True,
            'global_compatible':True if observed else None,'retained_bytes':retained_bytes,'global_bytes':current_bytes}
try:
    print(json.dumps(main(),allow_nan=False))
except Exception:
    print(json.dumps({'code':'ATTEMPT_PROOF_READBACK_FAILED'}))
    raise SystemExit(1)
'''


def native_command(status):
    if not isinstance(status, dict) or not isinstance(status.get('attempt_id'), str) or not re.fullmatch(r'[a-f0-9]{32}', status['attempt_id']):
        raise ValueError('ATTEMPT_PROOF_READBACK_INVALID')
    if status.get('status') not in {'VERIFIED', 'VERIFIED_WITH_WARNINGS', 'NOT_ISSUED', 'FAILED', 'PLAN_CHANGED'}:
        raise ValueError('ATTEMPT_PROOF_READBACK_INVALID')
    return ['exec', '--user', '1000:1000', 'aemr-server-1', '/opt/report-env/bin/python', '-IB', '-c',
            NATIVE_PROGRAM, status['attempt_id'], expected_status_hash(status)]


def validate_result(result, status):
    observed = _eligible(status)
    keys = {'scope', 'format', 'coverage', 'proof_matches', 'global_compatible', 'retained_bytes', 'global_bytes'}
    if (not isinstance(result, dict) or set(result) != keys or result['scope'] != 'SINGLE_RETAINED_ATTEMPT'
            or result['format'] != ('REFERENCE' if observed else 'INLINE')
            or result['coverage'] != ('OBSERVED' if observed else 'NOT_OBSERVED')
            or result['proof_matches'] is not True or result['global_compatible'] is not (True if observed else None)
            or type(result['retained_bytes']) is not int or not 0 < result['retained_bytes'] <= MAX_BYTES
            or (observed and (type(result['global_bytes']) is not int or not 0 < result['global_bytes'] <= MAX_BYTES))
            or (not observed and result['global_bytes'] is not None)):
        raise ValueError('ATTEMPT_PROOF_READBACK_INVALID')
    return result
