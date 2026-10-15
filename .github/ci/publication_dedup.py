"""Share exact immutable JSON bytes; leave every published reader contract intact.

Bundled before record_rollback_lineage.py by the owner-only maintenance job.
The latter verifies root tools, full trial, runtime, quarantine, lock and Word.
"""
import hashlib
import json
import os
import re
import sqlite3
import stat
from pathlib import Path


def _closed_aliases(source, groups, extra=None):
    aliases={}
    paths=[source/record['relative'] for group in groups for record in group]
    if extra is not None:paths.append(extra)
    for path in paths:
        value=path.lstat()
        if not stat.S_ISREG(value.st_mode):raise ValueError('DEDUP_UNSAFE_PATH')
        aliases.setdefault((value.st_dev,value.st_ino),[]).append(value)
    if any(values[0].st_nlink!=len(values) for values in aliases.values()):
        raise ValueError('DEDUP_EXTERNAL_LINK')


def _checked_file(root, relative, expected):
    path=root/relative
    if any(p.is_symlink() for p in (path,*path.parents)):
        raise ValueError('DEDUP_UNSAFE_PATH')
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as file:
        before=os.fstat(file.fileno())
        if (not stat.S_ISREG(before.st_mode)
                or (before.st_size,before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode))
                != tuple(expected[k] for k in ('bytes','uid','gid','mode'))):
            raise ValueError('DEDUP_METADATA_CHANGED')
        digest=hashlib.file_digest(file,'sha256').hexdigest()
        after=os.fstat(file.fileno())
    signature=lambda value:tuple(getattr(value,k) for k in
        ('st_dev','st_ino','st_size','st_uid','st_gid','st_mode','st_mtime_ns','st_ctime_ns'))
    if (digest!=expected['sha256'] or signature(before)!=signature(after)
            or path.stat().st_ino!=after.st_ino):
        raise ValueError('DEDUP_CONTENT_CHANGED')
    return after


def plan_dedup(source, files, catalog, *, min_bytes=1024**2):
    groups={}
    for relative, value in files.items():
        if (not isinstance(relative,str) or not relative.endswith('.json')
                or not relative.startswith('reports/published/releases/')
                or not isinstance(value,dict) or value.get('kind') not in (None,'file')
                or type(value.get('bytes')) is not int or value['bytes']<min_bytes):
            continue
        match=re.fullmatch(r'reports/published/releases/(REL-[a-f0-9]{64})/(.+\.json)',relative)
        if '..' in Path(relative).parts or Path(relative).as_posix()!=relative:
            raise ValueError('DEDUP_UNSAFE_PATH')
        # Historical/pending directories are outside the immutable catalog scope.
        # Their presence is neither corruption nor permission to rewrite them.
        if not match:continue
        release,name=match.groups()
        if release not in catalog:continue
        if catalog.get(release,{}).get(name)!=value.get('sha256'):
            raise ValueError('DEDUP_CATALOG_MISMATCH')
        key=tuple(value.get(k) for k in ('sha256','bytes','uid','gid','mode'))
        groups.setdefault(key,[]).append({'relative':relative,'expected':dict(value)})
    selected=[group for group in groups.values() if len(group)>1]
    aliases={}
    for group in selected:
        for record in group:
            info=_checked_file(source,record['relative'],record['expected'])
            record['inode']=(info.st_dev,info.st_ino)
            aliases.setdefault(record['inode'],[]).append(info)
    if any(items[0].st_nlink!=len(items) for items in aliases.values()):
        raise ValueError('DEDUP_EXTERNAL_LINK')
    return selected


def apply_dedup(source, groups, staging, *, observe=lambda:None):
    if any(p.is_symlink() for p in (source,staging,*source.parents,*staging.parents)):
        raise ValueError('DEDUP_STAGING_UNSAFE')
    source=source.resolve(strict=True);staging=staging.resolve(strict=True)
    if source==staging or source in staging.parents or staging.stat().st_dev!=source.stat().st_dev:
        raise ValueError('DEDUP_STAGING_UNSAFE')
    if list(staging.iterdir()):
        raise ValueError('DEDUP_STAGING_NOT_EMPTY')
    # Validate the WHOLE plan before any replacement, including no raced writes.
    aliases={}
    for group in groups:
        for record in group:
            info=_checked_file(source,record['relative'],record['expected'])
            if (info.st_dev,info.st_ino)!=tuple(record['inode']):
                raise ValueError('DEDUP_PLAN_CHANGED')
            aliases.setdefault((info.st_dev,info.st_ino),[]).append(info)
    if any(items[0].st_nlink!=len(items) for items in aliases.values()):
        raise ValueError('DEDUP_EXTERNAL_LINK')
    linked=0
    for group in groups:
        original=source/group[0]['relative']
        for record in group[1:]:
            destination=source/record['relative']
            if original.samefile(destination):
                continue
            _checked_file(source,group[0]['relative'],group[0]['expected'])
            _checked_file(source,record['relative'],record['expected'])
            temporary=staging/'link'
            try:
                # Extra entries INSIDE a release make old _checked() reject it.
                os.link(original,temporary,follow_symlinks=False)
                staged=_checked_file(staging,'link',group[0]['expected'])
                if (staged.st_dev,staged.st_ino)!=tuple(group[0]['inode']):
                    raise ValueError('DEDUP_PLAN_CHANGED')
                current=_checked_file(source,record['relative'],record['expected'])
                if (current.st_dev,current.st_ino)!=tuple(record['inode']):
                    raise ValueError('DEDUP_PLAN_CHANGED')
                _closed_aliases(source,[group],extra=temporary)
                os.replace(temporary,destination)
                fd=os.open(destination.parent,os.O_RDONLY|os.O_DIRECTORY)
                try:os.fsync(fd)
                finally:os.close(fd)
            finally:
                if os.path.lexists(temporary):temporary.unlink()
            linked+=1
            observe()
    for group in groups:
        for record in group:_checked_file(source,record['relative'],record['expected'])
    _closed_aliases(source,groups)
    return {'linked_files':linked}


def deduplicate_immutable_payloads(executor,r,plan):
    import fcntl
    import shutil
    import tempfile

    # Completed rollback/unchanged quarantine/runtime continuity is mandatory.
    record_lineage(executor,r,plan)  # noqa: F821 - verified companion source in the same program
    source=executor._volume(plan)
    root=source/'reports/published'
    lock=root/'publication.lock'
    if any(p.is_symlink() for p in (lock,*lock.parents,root/'publications.sqlite')):
        raise ValueError('DEDUP_UNSAFE_PATH')
    with lock.open('r+') as handle:
        fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        backup=r.BACKUP_BASE/plan['backup_reference']
        body=r.read_owned(backup/'manifest.json',limit=16*1024**2)
        if r.digest(body)!=plan['manifest_sha256']:
            raise ValueError('DEDUP_CHECKPOINT_CHANGED')
        manifest=json.loads(body)
        with sqlite3.connect((root/'publications.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            rows=db.execute('select release_id,files from publications').fetchall()
        catalog={release:json.loads(files) for release,files in rows}
        groups=plan_dedup(source,manifest['files'],catalog)
        base=r.STATE_DIR/'publication-dedup';base.mkdir(mode=0o700,exist_ok=True);r.private_directory(base)
        r.atomic_json(base/'plan.json',{'manifest_sha256':plan['manifest_sha256'],'groups':groups})
        before=shutil.disk_usage(source).free
        with tempfile.TemporaryDirectory(prefix='links-',dir=base) as directory:
            result=apply_dedup(source,groups,Path(directory))
        executor._verify_api_word(plan)
        result.update(state='IMMUTABLE_JSON_DEDUP_VERIFIED',manifest_sha256=plan['manifest_sha256'],
                      free_before_bytes=before,free_after_bytes=shutil.disk_usage(source).free)
        r.atomic_json(base/'result.json',result)
        print(json.dumps(result),flush=True)

