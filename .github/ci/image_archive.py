"""Archive one exact unused historical image before its guarded retirement."""
import gzip
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import time
import types
from pathlib import Path

SOURCE='43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa'
IMAGE='sha256:e5d8535fd30b9624cf0b3791cab447e326effe16fb847300837bc2e21024ec0d'
TAG='aemr-server:release-'+SOURCE
ACCEPTED_SOURCE='78d293b217a8afe982583c73bc67aaccdb4d906c'
PENDING_SOURCE='ed3e4589a33a4b5bed3f4cab684ef1d519d0290d'
CURRENT_IMAGES={
    'server':'sha256:8e81e27ee31262a9f145f3a5927c1bc05d0cbe19a0413e7c074700dc9bebadfb',
    'report-worker':'sha256:8e81e27ee31262a9f145f3a5927c1bc05d0cbe19a0413e7c074700dc9bebadfb',
    'web':'sha256:aa172137b99bcf2b25bf1d9f5c10ddb81fc97a80a7734aba719bab41ad0ea9f0',
    'caddy':'sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d',
}
BASE=Path('/root/codex-fixes/image-retirement')/SOURCE
MAX_RAW=2*1024**3
MAX_ARCHIVE=512*1024**2
RESERVE=1024**3
RECOVERY_SHA256='7442ffc75007a44bc9c00e6bdb93cb8c32954890d461e27b1a628f8ecfbcf2b6'
ROUNDTRIP_RUN='39051472665'
ROUNDTRIP_OPS='48bc5d648192f697bfca5965e009ed1af5af67b9'


def admit_image(image,containers,protected):
    if (not isinstance(image,dict) or image.get('Id')!=IMAGE or image.get('RepoTags')!=[TAG]
            or not isinstance(image.get('Config'),dict)
            or (image['Config'].get('Labels') or {}).get('org.opencontainers.image.revision')!=SOURCE
            or IMAGE in protected or any(value.get('Image')==IMAGE for value in containers)):
        raise ValueError('IMAGE_ARCHIVE_TARGET_REJECTED')
    return {'image_id':IMAGE,'source_sha':SOURCE,'tag':TAG}


def admit_runtime(plan,marker,stage,containers):
    wanted={'state':'RELEASE_CANDIDATE_ACCEPTED','release_sha':plan.get('release_sha'),
            'manifest_sha256':plan.get('manifest_sha256'),'candidate_images':plan.get('candidate_images'),
            'config_sha256':plan.get('config_sha256'),'word_sha256':plan.get('word',{}).get('sha256')}
    if (plan.get('release_sha')!=ACCEPTED_SOURCE or plan.get('candidate_images')!=CURRENT_IMAGES
            or stage.get('release_sha')!=PENDING_SOURCE or stage.get('images')!=CURRENT_IMAGES
            or marker!={'plan_sha256':hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest(),
                        'acceptance':wanted}):
        raise ValueError('IMAGE_ARCHIVE_RUNTIME_REJECTED')
    protected=set()
    for images in (plan.get('images'),plan.get('candidate_images'),stage.get('images'),stage.get('candidate_images')):
        if (not isinstance(images,dict) or set(images)!=set(CURRENT_IMAGES)
                or any(not isinstance(value,str) or not re.fullmatch('sha256:[a-f0-9]{64}',value) for value in images.values())):
            raise ValueError('IMAGE_ARCHIVE_RUNTIME_REJECTED')
        protected.update(images.values())
    if not isinstance(containers,list) or not 4<=len(containers)<=256:raise ValueError('IMAGE_ARCHIVE_RUNTIME_REJECTED')
    for role,identity in CURRENT_IMAGES.items():
        rows=[value for value in containers if value.get('Name')=='/aemr-'+role+'-1']
        if len(rows)!=1:raise ValueError('IMAGE_ARCHIVE_RUNTIME_REJECTED')
        value=rows[0];state=value.get('State',{});labels=(value.get('Config',{}).get('Labels') or {})
        if (value.get('Image')!=identity or value.get('RestartCount')!=0 or state.get('Status')!='running'
                or state.get('OOMKilled') is not False or labels.get('com.docker.compose.project')!='aemr'
                or labels.get('com.docker.compose.service')!=role
                or (role=='server' and state.get('Health',{}).get('Status')!='healthy')):
            raise ValueError('IMAGE_ARCHIVE_RUNTIME_REJECTED')
    protected.update(value['Image'] for value in containers)
    return protected


def registry_references(image):
    refs=image.get('RepoDigests')
    if refs is None:refs=[]
    if not isinstance(refs,list) or any(not isinstance(value,str) or not value for value in refs):
        raise ValueError('IMAGE_ARCHIVE_REGISTRY_REFERENCE_INVALID')
    return sorted(refs)


def verify_loaded_image(original,loaded):
    admit_image(original,[],set());admit_image(loaded,[],set())
    if any(original.get(key)!=loaded.get(key) for key in ('Id','Config','RootFS','Os','Architecture')):
        raise ValueError('IMAGE_ARCHIVE_LOADED_IMAGE_MISMATCH')
    if registry_references(original)!=registry_references(loaded):
        raise ValueError('IMAGE_ARCHIVE_REGISTRY_REFERENCE_MISMATCH')


def compress_archive(raw,target,*,max_bytes=MAX_ARCHIVE,reserve_bytes=RESERVE):
    raw,target=Path(raw),Path(target)
    if raw.is_symlink() or not raw.is_file() or not 0<raw.stat().st_size<=MAX_RAW:
        raise ValueError('IMAGE_ARCHIVE_RAW_SIZE_INVALID')
    if shutil.disk_usage(target.parent).free<max_bytes+reserve_bytes:
        raise ValueError('IMAGE_ARCHIVE_SPACE_INSUFFICIENT')
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    deadline=time.monotonic()+90
    try:
        with os.fdopen(fd,'wb') as destination,os.fdopen(os.open(raw,os.O_RDONLY|os.O_NOFOLLOW),'rb') as source:
            os.fchmod(destination.fileno(),0o600)
            before=os.fstat(source.fileno())
            with gzip.GzipFile(filename='',mode='wb',compresslevel=1,fileobj=destination,mtime=0) as compressed:
                while chunk:=source.read(1024**2):
                    if time.monotonic()>deadline:raise ValueError('IMAGE_ARCHIVE_TIMEOUT')
                    if shutil.disk_usage(target.parent).free<reserve_bytes:raise ValueError('IMAGE_ARCHIVE_SPACE_INSUFFICIENT')
                    compressed.write(chunk)
                    if destination.tell()>max_bytes:raise ValueError('IMAGE_ARCHIVE_COMPRESSED_SIZE_INVALID')
            destination.flush();os.fsync(destination.fileno())
            after=os.fstat(source.fileno())
            keys=('st_dev','st_ino','st_size','st_mode','st_mtime_ns','st_ctime_ns')
            if any(getattr(before,key)!=getattr(after,key) for key in keys):raise ValueError('IMAGE_ARCHIVE_RAW_CHANGED')
        if target.stat().st_size>max_bytes:raise ValueError('IMAGE_ARCHIVE_COMPRESSED_SIZE_INVALID')
        with target.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        return {'archive_bytes':target.stat().st_size,'archive_sha256':digest}
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def check_receipt(ready,receipt):
    if (not isinstance(receipt,dict) or set(receipt)!=set(ready)|{
            'state','runner_engine_version','run_id','run_attempt','ops_sha'}
            or any(receipt.get(key)!=value for key,value in ready.items())
            or receipt['state']!='IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED' or receipt['runner_engine_version']!='29.1.3'
            or not all(isinstance(receipt[key],str) and re.fullmatch('[1-9][0-9]{0,19}',receipt[key]) for key in ('run_id','run_attempt'))
            or not isinstance(receipt['ops_sha'],str) or not re.fullmatch('[a-f0-9]{40}',receipt['ops_sha'])):
        raise ValueError('IMAGE_ARCHIVE_RECEIPT_REJECTED')
    return receipt


def load_recovery(path):
    path=Path(path)
    if any(value.is_symlink() for value in (path,*path.parents)):
        raise ValueError('IMAGE_ARCHIVE_RECOVERY_SOURCE_UNTRUSTED')
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        info=os.fstat(stream.fileno());body=stream.read(1024**2+1)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or info.st_mode&0o022
            or len(body)>1024**2 or hashlib.sha256(body).hexdigest()!=RECOVERY_SHA256):
        raise ValueError('IMAGE_ARCHIVE_RECOVERY_SOURCE_UNTRUSTED')
    module=types.ModuleType('pinned_image_archive_recovery');module.__file__=str(path)
    exec(compile(body,str(path),'exec'),module.__dict__)  # noqa: S102 - root-owned exact-SHA stdlib helper
    return module


def runtime_context(r,command):
    for directory in (r.STATE_DIR,r.RUNTIME_DIR,r.BACKUP_BASE):
        if any(value.is_symlink() for value in (directory,*directory.parents)):
            raise ValueError('IMAGE_ARCHIVE_UNSAFE_PATH')
        r.private_directory(directory)
    if (any(os.path.lexists(r.STATE_DIR/name) for name in ('pending-release.json','release-recovery-progress.json'))
            or list(r.BACKUP_BASE.glob('*/quiescent'))):
        raise ValueError('IMAGE_ARCHIVE_RELEASE_ACTIVE')
    bodies={name:r.read_owned(path,limit=65536) for name,path in {
        'plan':r.RUNTIME_DIR/'trial-plan.json','marker':r.STATE_DIR/'release-accepted.json',
        'stage':r.RUNTIME_DIR/'stage.json'}.items()}
    identities=command(['ps','--all','--quiet','--no-trunc'],timeout=30).split()
    if not 4<=len(identities)<=256 or any(not re.fullmatch('[a-f0-9]{64}',value) for value in identities):
        raise ValueError('IMAGE_ARCHIVE_RUNTIME_REJECTED')
    raw=command(['inspect',*identities],timeout=30)
    if len(raw)>4*1024**2:raise ValueError('IMAGE_ARCHIVE_RUNTIME_REJECTED')
    containers=json.loads(raw)
    protected=admit_runtime(*(json.loads(bodies[name]) for name in ('plan','marker','stage')),containers)
    # Ignore changing health timestamps/counters and child PIDs. Container
    # identity, settings, mounts, top-level PID and health must remain stable.
    stable={value['Id']:{**{key:value.get(key) for key in ('Id','Image','Name','Config','HostConfig','Mounts','RestartCount')},
            'state':{key:value.get('State',{}).get(key) for key in ('Status','StartedAt','OOMKilled','Pid')},
            'health':value.get('State',{}).get('Health',{}).get('Status')} for value in containers}
    frame={key:hashlib.sha256(value).hexdigest() for key,value in bodies.items()}
    frame['containers_sha256']=hashlib.sha256(json.dumps(stable,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return frame,containers,protected


def current_context(r,command):
    frame,containers,protected=runtime_context(r,command)
    images=json.loads(command(['image','inspect',IMAGE],timeout=30))
    if not isinstance(images,list) or len(images)!=1:raise ValueError('IMAGE_ARCHIVE_TARGET_REJECTED')
    image=images[0];admit_image(image,containers,protected)
    return frame,image


def checked_archive(r,base):
    if any(os.path.lexists(base/name) for name in ('image.tar.pending','image.tar.gz.pending')):
        raise ValueError('IMAGE_ARCHIVE_PENDING_INSPECTION')
    ready=json.loads(r.read_owned(base/'ready.json',limit=4096))
    expected={'image_id':IMAGE,'source_sha':SOURCE,'tag':TAG}
    if (set(ready)!=set(expected)|{'archive_bytes','archive_sha256','image_metadata_sha256'}
            or any(ready.get(key)!=value for key,value in expected.items())
            or type(ready.get('archive_bytes')) is not int or not 0<ready['archive_bytes']<=MAX_ARCHIVE
            or any(not isinstance(ready.get(key),str) or not re.fullmatch('[a-f0-9]{64}',ready[key])
                   for key in ('archive_sha256','image_metadata_sha256'))):
        raise ValueError('IMAGE_ARCHIVE_READY_REJECTED')
    metadata=r.read_owned(base/'image-metadata.json')
    if hashlib.sha256(metadata).hexdigest()!=ready['image_metadata_sha256']:
        raise ValueError('IMAGE_ARCHIVE_METADATA_CHANGED')
    with os.fdopen(os.open(base/'image.tar.gz',os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        info=os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1
                or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size!=ready['archive_bytes']
                or hashlib.file_digest(stream,'sha256').hexdigest()!=ready['archive_sha256']):
            raise ValueError('IMAGE_ARCHIVE_CONTENT_CHANGED')
    image=json.loads(metadata);admit_image(image,[],set())
    return ready,image


def export_image(path,lock_fd):
    if shutil.disk_usage(path.parent).free<MAX_RAW+MAX_ARCHIVE+RESERVE:
        raise ValueError('IMAGE_ARCHIVE_SPACE_INSUFFICIENT')
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as output, \
         os.fdopen(os.open(path.parent/'export-error.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as errors:
        # The child keeps maintenance EX even if the orchestrator dies. Its
        # independent native deadline and file cap bound orphan scratch writes.
        process=subprocess.Popen(['/usr/bin/timeout','--kill-after=5s','120s','/usr/bin/prlimit',
            f'--fsize={MAX_RAW}:{MAX_RAW}','--','/usr/bin/docker','image','save',TAG],stdout=output,stderr=errors,
            pass_fds=(lock_fd,),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','DOCKER_CONFIG':'/etc/aemr/docker'})
        try:
            deadline=time.monotonic()+120
            while process.poll() is None:
                if time.monotonic()>deadline:raise ValueError('IMAGE_ARCHIVE_EXPORT_TIMEOUT')
                if shutil.disk_usage(path.parent).free<RESERVE:raise ValueError('IMAGE_ARCHIVE_SPACE_INSUFFICIENT')
                if os.fstat(errors.fileno()).st_size>1024**2:raise ValueError('IMAGE_ARCHIVE_EXPORT_LOG_SIZE_INVALID')
                time.sleep(0.2)
            output.flush();os.fsync(output.fileno())
            if process.returncode or not 0<os.fstat(output.fileno()).st_size<=MAX_RAW:
                raise ValueError('IMAGE_ARCHIVE_EXPORT_FAILED')
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


def prepare(r,command,base,lock_fd):
    r.require_lock(lock_fd);r.private_directory(base)
    if any(value.is_symlink() for value in (base,*base.parents)):raise ValueError('IMAGE_ARCHIVE_UNSAFE_PATH')
    before,image=current_context(r,command)
    if os.path.lexists(base/'ready.json'):
        ready,original=checked_archive(r,base);verify_loaded_image(original,image)
        return ready
    if list(base.iterdir()):raise ValueError('IMAGE_ARCHIVE_PENDING_INSPECTION')
    r.atomic_json(base/'image-metadata.json',image);r.atomic_json(base/'runtime-context.json',before)
    raw=base/'image.tar.pending';export_image(raw,lock_fd)
    archive=base/'image.tar.gz.pending'
    result=compress_archive(raw,archive)
    after,current=current_context(r,command)
    if before!=after:raise ValueError('IMAGE_ARCHIVE_RUNTIME_CHANGED')
    verify_loaded_image(image,current);r.require_lock(lock_fd)
    os.replace(archive,base/'image.tar.gz');r.fsync_directory(base)
    ready={'image_id':IMAGE,'source_sha':SOURCE,'tag':TAG,**result,
           'image_metadata_sha256':hashlib.sha256(r.read_owned(base/'image-metadata.json')).hexdigest()}
    raw.unlink();r.fsync_directory(base)
    r.atomic_json(base/'ready.json',ready)
    return ready


def save_receipt(r,base,receipt,lock_fd):
    r.require_lock(lock_fd)
    ready,_=checked_archive(r,base)
    check_receipt(ready,receipt)
    path=base/('roundtrip-'+receipt['run_id']+'-'+receipt['run_attempt']+'.json')
    if os.path.lexists(path):
        if json.loads(r.read_owned(path))!=receipt:raise ValueError('IMAGE_ARCHIVE_RECEIPT_CHANGED')
    else:r.atomic_json(path,receipt)


def admit_retirement_proof(ready,proof,image):
    check_receipt(ready,proof)
    if (proof['run_id']!=ROUNDTRIP_RUN or proof['run_attempt']!='1' or proof['ops_sha']!=ROUNDTRIP_OPS):
        raise ValueError('IMAGE_ARCHIVE_ROUNDTRIP_NOT_ACCEPTED')
    # This exact later proof also compared every registry reference. The older
    # image/tag-only proof is intentionally not eligible for retirement.
    registry_references(image)


def image_inventory(command):
    identities=sorted(set(command(['image','ls','--all','--quiet','--no-trunc'],timeout=30).split()))
    if not 1<=len(identities)<=256 or any(not re.fullmatch('sha256:[a-f0-9]{64}',value) for value in identities):
        raise ValueError('IMAGE_ARCHIVE_INVENTORY_REJECTED')
    body=command(['image','inspect',*identities],timeout=30)
    if len(body)>4*1024**2:raise ValueError('IMAGE_ARCHIVE_INVENTORY_REJECTED')
    values=json.loads(body)
    if not isinstance(values,list) or sorted(row.get('Id','') for row in values)!=identities:
        raise ValueError('IMAGE_ARCHIVE_INVENTORY_REJECTED')
    return {row['Id']:{key:row.get(key) for key in ('Id','Config','RootFS','Os','Architecture','RepoTags','RepoDigests')}
            for row in values}


def native_smoke(command):
    result=json.loads(command(['exec','aemr-server-1','/opt/report-env/bin/python','-m',
                              'procurement_engine.deployment_smoke'],timeout=180))
    keys=('context','snapshot','main','supplement','operational')
    if not isinstance(result,dict) or any(result.get(key)!='PASS' for key in keys):
        raise ValueError('IMAGE_ARCHIVE_NATIVE_SMOKE_FAILED')
    return {key:'PASS' for key in keys}


def retire_image(r,command,base,lock_fd):
    r.require_lock(lock_fd);r.private_directory(base)
    if any(value.is_symlink() for value in (base,*base.parents)):raise ValueError('IMAGE_ARCHIVE_UNSAFE_PATH')
    journal=base/'retirement.json'
    if os.path.lexists(journal):raise ValueError('IMAGE_ARCHIVE_RETIREMENT_ALREADY_RECORDED')
    ready,archived=checked_archive(r,base)
    proof=json.loads(r.read_owned(base/('roundtrip-'+ROUNDTRIP_RUN+'-1.json'),limit=16384))
    admit_retirement_proof(ready,proof,archived)
    before,image=current_context(r,command);verify_loaded_image(archived,image)
    images=image_inventory(command)
    before_smoke=native_smoke(command)
    confirmed,current=current_context(r,command)
    if before!=confirmed or images!=image_inventory(command):raise ValueError('IMAGE_ARCHIVE_RUNTIME_CHANGED')
    verify_loaded_image(archived,current);admit_retirement_proof(ready,proof,current);r.require_lock(lock_fd)
    intent={'state':'IMAGE_RETIREMENT_INTENT',**ready,'roundtrip_run_id':ROUNDTRIP_RUN,
            'runtime_context':before,'image_count_before':len(images),'native_before':before_smoke,
            'free_bytes_before':shutil.disk_usage(base).free,
            'reload_argv':['/usr/bin/docker','image','load','--input',str(base/'image.tar.gz')]}
    r.atomic_json(journal,intent)
    # Exact immutable ID, no force and no parent pruning: Docker rejects a
    # concurrent container reference. Archive and all checkpoints stay intact.
    command(['image','rm','--no-prune',IMAGE],timeout=120,lock_fd=lock_fd)
    after,_,_=runtime_context(r,command)
    remaining=image_inventory(command)
    if before!=after or remaining!={key:value for key,value in images.items() if key!=IMAGE}:
        raise ValueError('IMAGE_ARCHIVE_RETIREMENT_READBACK_FAILED')
    after_smoke=native_smoke(command)
    if runtime_context(r,command)[0]!=before:raise ValueError('IMAGE_ARCHIVE_RUNTIME_CHANGED')
    checked_archive(r,base);r.require_lock(lock_fd)
    result={**intent,'state':'IMAGE_RETIRED_RECOVERABLY','native_after':after_smoke,
            'image_count_after':len(remaining),'free_bytes_after':shutil.disk_usage(base).free}
    result['measured_free_delta_bytes']=result['free_bytes_after']-result['free_bytes_before']
    r.atomic_json(journal,result)
    return {key:result[key] for key in ('state','image_id','archive_bytes','archive_sha256',
            'image_count_before','image_count_after','free_bytes_before','free_bytes_after','measured_free_delta_bytes',
            'native_before','native_after')}


def main():
    import base64
    import fcntl
    import sys

    if os.geteuid()!=0:raise ValueError('IMAGE_ARCHIVE_ROOT_REQUIRED')
    if not (sys.argv[1:] in (['--prepare'],['--retire']) or len(sys.argv)==3 and sys.argv[1]=='--receipt'):
        raise ValueError('IMAGE_ARCHIVE_ARGUMENT_INVALID')
    os.umask(0o077);os.nice(10)
    r=load_recovery('/usr/local/libexec/aemr/release_recovery.py')
    with os.fdopen(os.open(r.LOCK,os.O_RDWR|os.O_NOFOLLOW),'r+') as lock:
        deadline=time.monotonic()+45
        while True:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:
                if time.monotonic()>deadline:raise ValueError('IMAGE_ARCHIVE_MAINTENANCE_BUSY') from None
                time.sleep(0.2)
        r.require_lock(lock.fileno())
        for path in (BASE.parent.parent,*BASE.parent.parent.parents):
            info=path.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:
                raise ValueError('IMAGE_ARCHIVE_UNSAFE_PATH')
        for directory in (BASE.parent,BASE):
            directory.mkdir(mode=0o700,exist_ok=True);r.private_directory(directory)
        if sys.argv[1]=='--prepare':
            result=prepare(r,r.docker,BASE,lock.fileno())
            print(json.dumps({'state':'IMAGE_ARCHIVE_READY',**result}),flush=True)
        elif sys.argv[1]=='--retire':
            print(json.dumps(retire_image(r,r.docker,BASE,lock.fileno())),flush=True)
        else:
            if len(sys.argv[2])>16384:raise ValueError('IMAGE_ARCHIVE_RECEIPT_REJECTED')
            current_context(r,r.docker)
            receipt=json.loads(base64.b64decode(sys.argv[2],validate=True))
            save_receipt(r,BASE,receipt,lock.fileno())
            print(json.dumps({'state':'IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED','archive_bytes':receipt['archive_bytes'],
                              'archive_sha256':receipt['archive_sha256'],'image_id':IMAGE}),flush=True)


if __name__=='__main__':
    try:main()
    except Exception as error:  # noqa: BLE001 - never print Docker stderr or private metadata
        import sys

        message=str(error)
        code=message if re.fullmatch('IMAGE_ARCHIVE_[A-Z_]+',message) else 'IMAGE_ARCHIVE_PREPARATION_REJECTED'
        print(json.dumps({'state':'FAILED','code':code,'kind':type(error).__name__}),flush=True)
        sys.exit(2)
