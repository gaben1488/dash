import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path

SERVICES={"/aemr-"+name+"-1":name for name in ("server","web","caddy","report-worker")}
OPERATIONS={"match-source","restore-state","restore-reports","initialize-publication-readers"}
def safe_record(value):
 state=value.get("State",{});config=value.get("Config",{});image=value.get("Image","");labels=config.get("Labels") or {}
 return {"service":SERVICES.get(value.get("Name"),"OTHER"),
  "project_owned":labels.get("com.docker.compose.project")=="aemr",
  "compose_service":labels.get("com.docker.compose.service") if labels.get("com.docker.compose.service") in {"server","web","caddy","report-worker"} else None,
  "oneoff":labels.get("com.docker.compose.oneoff") if labels.get("com.docker.compose.oneoff") in {"False","false","True","true"} else None,
  "image":image if re.fullmatch(r"sha256:[a-f0-9]{64}",image) else None,
  "state":state.get("Status") if state.get("Status") in {"created","running","paused","restarting","exited","dead","removing"} else None,
  "health":state.get("Health",{}).get("Status") if state.get("Health",{}).get("Status") in {"healthy","unhealthy","starting"} else None,
  "oom":state.get("OOMKilled") is True,"restarts":value.get("RestartCount") if type(value.get("RestartCount")) is int else None,
  "pid":state.get("Pid") if type(state.get("Pid")) is int else None,
  "data_volume":any(m.get("Name")=="aemr_server_data" for m in value.get("Mounts",[])),
  "operations":sorted(set(config.get("Cmd") or [])&OPERATIONS)}
def snapshot(command):
 ids=command(["docker","ps","--all","--quiet","--no-trunc"]).split()
 records=json.loads(command(["docker","inspect",*ids])) if ids else []
 return [safe_record(v) for v in records]
def recovery_preflight():
 ids=subprocess.check_output(['docker','ps','--all','--quiet','--no-trunc'],text=True,timeout=15).split()
 for identifier in ids:
  record=json.loads(subprocess.check_output(['docker','inspect','--size',identifier],text=True,timeout=30))[0]
  if record.get('Name') in SERVICES:continue
  labels=record.get('Config',{}).get('Labels') or {}
  if labels.get('com.docker.compose.project')!='aemr':continue
  if labels.get('com.docker.compose.service') not in {'server','report-worker','web','caddy'}:continue
  assert re.fullmatch('[a-f0-9]{64}',record['Id'])
  source=Path('/var/lib/docker/volumes/aemr_server_data/_data')
  overlaps=[]
  for mount in record.get('Mounts',[]):
   value=mount.get('Source')
   actual=Path(value).resolve() if isinstance(value,str) and value.startswith('/') else None
   overlap=actual is not None and (actual==source or actual in source.parents or source in actual.parents)
   overlaps.append({'type':mount.get('Type') if mount.get('Type') in {'bind','volume','tmpfs'} else None,'state_overlap':overlap,'rw':mount.get('RW') is True})
  print(json.dumps({'recovery_survivor':{'id':record['Id'],'image':record.get('Image'),'status':record.get('State',{}).get('Status'),'size_rw':record.get('SizeRw'),'mounts':overlaps}}),flush=True)
 for name in ('runtime_guard.py','release_recovery.py'):
  path=Path('/usr/local/libexec/aemr')/name
  assert not path.is_symlink() and path.stat().st_uid==0
  print(json.dumps({'installed_tool':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}),flush=True)
 free=os.statvfs('/var/lib/docker')
 print(json.dumps({'root_available_bytes':free.f_bavail*free.f_frsize}),flush=True)

def attempt_retention_plan():
 image='sha256:545fd2b3cf69d73f22cd4a3639d51b37dab582f6bf2e92e78075d22f7be59d25'
 value=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True,timeout=15))[0]
 assert value['Id']==image and value['Config']['Labels']['org.opencontainers.image.revision']=='394c7e853a2b326b9a5c89ea52f60c51e075302e'
 program="from procurement_engine.retention import plan_transient_attempt_retention\nimport json\nx=plan_transient_attempt_retention('/state/reports',keep_full=2)\nprint(json.dumps({'attempt_retention_plan':{k:x.get(k) for k in ('status','attempt_count','compact_count','bytes_reclaimable','protected_unsealed_thursdays','malformed_or_unsafe_entries')}}))\n"
 result=subprocess.run(['docker','run','--rm','-i','--network','none','--read-only','--memory','2304m','--memory-swap','2816m','--pids-limit','32','--cpus','1','--cpu-shares','256','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--entrypoint','/usr/bin/timeout','--mount','type=volume,source=aemr_server_data,target=/state,readonly',image,'--kill-after=2s','120s','/opt/report-env/bin/python','-B','-'],input=program,capture_output=True,text=True,timeout=140,check=False)
 for line in result.stdout.splitlines():
  try:
   x=json.loads(line)
   if 'attempt_retention_plan' in x:print(json.dumps(x),flush=True)
  except (ValueError,TypeError):pass
 print(json.dumps({'attempt_retention_plan_exit':result.returncode}),flush=True)

def previous_reader_capabilities():
 image='sha256:a2b6a1b9a4726e620f77405468f877a20ba1de07c69b8ede4e16a52b46198bac'
 value=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True,timeout=15))[0]
 revision=(value.get('Config',{}).get('Labels') or {}).get('org.opencontainers.image.revision')
 print(json.dumps({'previous_runtime_source':revision if isinstance(revision,str) and re.fullmatch('[a-f0-9]{40}',revision) else None}),flush=True)
 program="import inspect,json,hashlib,importlib\nfrom pathlib import Path\nfrom procurement_engine.publication_store import PublicationStore\nimport procurement_engine.publication_reader as reader\nresult={'compaction':hasattr(PublicationStore,'compact_publications'),'reader_lease':hasattr(PublicationStore,'reader_lease'),'selects_compact_period':'replay_available' in inspect.getsource(PublicationStore.select),'reader_uses_lease':'reader_lease' in inspect.getsource(reader.read_publication),'module_sha256':{}}\nfor name in ('publication_store','publication_reader','archive_runtime','monitoring_schema','storage_inventory','rehearsal'):\n try:module=importlib.import_module('procurement_engine.'+name);result['module_sha256'][name]=hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()\n except ImportError:result['module_sha256'][name]=None\nprint(json.dumps({'previous_reader_capabilities':result}))\n"
 result=subprocess.run(['docker','run','--rm','--network','none','--read-only','--memory','256m','--pids-limit','32','--cpus','0.5','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--entrypoint','/usr/bin/timeout',image,'--kill-after=2s','30s','/opt/report-env/bin/python','-B','-c',program],capture_output=True,text=True,timeout=40,check=False)
 for line in result.stdout.splitlines():
  try:
   x=json.loads(line)
   if 'previous_reader_capabilities' in x:print(json.dumps(x),flush=True)
  except (ValueError,TypeError):pass
 print(json.dumps({'previous_reader_capabilities_exit':result.returncode}),flush=True)

def host_space_census():
 paths=('/root/codex-fixes','/home/aemr/dash','/opt/aemr','/tmp','/var/tmp','/root/.cache','/home/aemr/.cache','/root/.local/share','/home/aemr/.local/share','/var/cache','/var/log','/home/aemr/.dash-private-backups')
 for path in paths:
  try:
   result=subprocess.run(['du','-sx','-B1','--',path],capture_output=True,text=True,timeout=20,check=False)
   field=result.stdout.partition('\t')[0].strip()
   print(json.dumps({'host_space_census':{'path':path,'bytes':int(field) if result.returncode==0 and field.isdigit() else None,'completed':result.returncode==0}}),flush=True)
  except subprocess.TimeoutExpired:print(json.dumps({'host_space_census':{'path':path,'completed':False}}),flush=True)

def image_space_census():
 for line in subprocess.check_output(['docker','system','df','--format','{{json .}}'],text=True,timeout=30).splitlines():
  value=json.loads(line)
  print(json.dumps({'docker_space':{k:value.get(k) for k in ('Type','TotalCount','Active','Size','Reclaimable')}}),flush=True)
 ids=subprocess.check_output(['docker','ps','--all','--quiet','--no-trunc'],text=True,timeout=15).split()
 references={v['Image'] for v in json.loads(subprocess.check_output(['docker','inspect',*ids],text=True,timeout=20))}
 ids=sorted(set(subprocess.check_output(['docker','image','ls','--all','--quiet','--no-trunc'],text=True,timeout=15).split()))
 for identity in ids:
  v=json.loads(subprocess.check_output(['docker','image','inspect',identity],text=True,timeout=15))[0]
  sha=(v.get('Config',{}).get('Labels') or {}).get('org.opencontainers.image.revision')
  tags=v.get('RepoTags') or []
  print(json.dumps({'image_space':{'id':v['Id'],'bytes':v['Size'],'referenced':v['Id'] in references,'source':sha if isinstance(sha,str) and re.fullmatch('[a-f0-9]{40}',sha) else None,'release_tags':[t for t in tags if re.fullmatch('aemr-(server|web):release-[a-f0-9]{40}',t)],'tag_count':len(tags)}}),flush=True)

def report_space_census():
 root=Path('/var/lib/docker/volumes/aemr_server_data/_data/reports')
 for name in ('attempts','published','archives','inputs'):
  path=root/name
  result=subprocess.run(['du','-sx','-B1','--',str(path)],capture_output=True,text=True,timeout=25,check=False)
  field=result.stdout.partition('\t')[0].strip()
  print(json.dumps({'report_space':{'kind':name,'bytes':int(field) if result.returncode==0 and field.isdigit() else None}}),flush=True)
 large=[]
 for directory in (root/'attempts').iterdir():
  if directory.is_symlink() or not directory.is_dir():continue
  result=subprocess.run(['du','-sx','-B1','--',str(directory)],capture_output=True,text=True,timeout=15,check=False)
  field=result.stdout.partition('\t')[0].strip()
  if result.returncode or not field.isdigit() or int(field)<10*1024**2:continue
  status=directory/'status.json';value={}
  if status.is_file() and not status.is_symlink() and status.stat().st_size<1024**2:
   try:value=json.loads(status.read_bytes())
   except (ValueError,TypeError):pass
  if not isinstance(value,dict):value={}
  known={'capture.json','bundle','status.json','error.json','failure-status.json','snapshot_bundle','report_model.json','identity.sqlite','identity.sqlite-wal','identity.sqlite-shm'}
  items=[]
  for child in directory.iterdir():
   result=subprocess.run(['du','-sx','-B1','--',str(child)],capture_output=True,text=True,timeout=15,check=False)
   field=result.stdout.partition('\t')[0].strip()
   items.append({'kind':child.name if child.name in known else 'OTHER','name_sha256':hashlib.sha256(child.name.encode()).hexdigest(),'bytes':int(field) if result.returncode==0 and field.isdigit() else None,'symlink':child.is_symlink()})
  large.append({'id':directory.name if re.fullmatch('[a-f0-9]{32}',directory.name) else hashlib.sha256(directory.name.encode()).hexdigest(),'bytes':int(subprocess.check_output(['du','-sx','-B1','--',str(directory)],text=True,timeout=15).split()[0]),'status_matches':value.get('attempt_id')==directory.name,'state':value.get('state') if value.get('state') in {'RUNNING','NOT_ISSUED','VERIFIED','VERIFIED_WITH_WARNINGS','FAILED'} else None,'items':items})
 print(json.dumps({'large_attempts':large}),flush=True)

def immutable_duplicate_preview():
 path=Path('/home/aemr/.dash-private-backups/worker-38792810076/backup/manifest.json')
 assert not any(p.is_symlink() for p in (path,*path.parents))
 info=path.stat();assert info.st_uid==0 and info.st_size<16*1024**2
 manifest=json.loads(path.read_bytes());groups={}
 for name,value in manifest['files'].items():
  if not name.startswith('reports/published/') or name.endswith('/') or not name.endswith('.json'):continue
  if not isinstance(value,dict) or value.get('kind')=='directory':continue
  sha=value.get('sha256');size=value.get('bytes')
  if not isinstance(sha,str) or not re.fullmatch('[a-f0-9]{64}',sha) or type(size) is not int or size<1024**2:continue
  key=(sha,size,value.get('uid'),value.get('gid'),value.get('mode'))
  groups.setdefault(key,[]).append(name)
 duplicate=[(k,v) for k,v in groups.items() if len(v)>1]
 print(json.dumps({'immutable_duplicate_preview':{'status':'MANIFEST_ONLY_UPPER_BOUND','groups':len(duplicate),'files':sum(len(v) for k,v in duplicate),'logical_duplicate_bytes':sum(k[1]*(len(v)-1) for k,v in duplicate),'content_changed':False}}),flush=True)

def attempt_json_preview():
 image='sha256:545fd2b3cf69d73f22cd4a3639d51b37dab582f6bf2e92e78075d22f7be59d25'
 program="import json\nfrom pathlib import Path\nfrom collections import Counter\nroot=Path('/state/reports');before=after=changed=skipped=valid=0;groups=Counter()\nfor path in (root/'attempts').glob('*/status.json'):\n if path.is_symlink() or path.stat().st_size>32*1024**2:skipped+=1;continue\n raw=path.read_bytes()\n try:value=json.loads(raw);compact=json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()\n except (ValueError,TypeError):skipped+=1;continue\n if not isinstance(value,dict):skipped+=1;continue\n valid+=1;before+=len(raw);after+=len(compact);changed+=int(len(raw)>len(compact))\n for key in ('automation_assurance','publication','source_observations','nonprocurement_identity_observations'):\n  if key in value:groups[key]+=len(json.dumps(value[key],ensure_ascii=False,separators=(',',':')).encode())\nprint(json.dumps({'attempt_json_preview':{'valid_files':valid,'skipped':skipped,'before_bytes':before,'compact_bytes':after,'potential_reclaimed':max(0,before-after),'reducible_files':changed,'field_bytes':dict(groups)}}))\n"
 result=subprocess.run(['docker','run','--rm','--network','none','--read-only','--memory','512m','--pids-limit','32','--cpus','1','--cpu-shares','256','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--entrypoint','/usr/bin/timeout','--mount','type=volume,source=aemr_server_data,target=/state,readonly',image,'--kill-after=2s','150s','/opt/report-env/bin/python','-B','-c',program],capture_output=True,text=True,timeout=170,check=False)
 for line in result.stdout.splitlines():
  try:
   value=json.loads(line)
   if 'attempt_json_preview' in value:print(json.dumps(value),flush=True)
  except (ValueError,TypeError):pass
 print(json.dumps({'attempt_json_preview_exit':result.returncode}),flush=True)

def live_dedup_plan():
 image='sha256:545fd2b3cf69d73f22cd4a3639d51b37dab582f6bf2e92e78075d22f7be59d25'
 program="import os,stat,re,hashlib,json,sqlite3,sys\nfrom pathlib import Path\ndef _checked_file(root, relative, expected):\n    path=root/relative\n    if any(p.is_symlink() for p in (path,*path.parents)):\n        raise ValueError('DEDUP_UNSAFE_PATH')\n    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as file:\n        before=os.fstat(file.fileno())\n        if (not stat.S_ISREG(before.st_mode)\n                or (before.st_size,before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode))\n                != tuple(expected[k] for k in ('bytes','uid','gid','mode'))):\n            raise ValueError('DEDUP_METADATA_CHANGED')\n        digest=hashlib.file_digest(file,'sha256').hexdigest()\n        after=os.fstat(file.fileno())\n    signature=lambda value:tuple(getattr(value,k) for k in\n        ('st_dev','st_ino','st_size','st_uid','st_gid','st_mode','st_mtime_ns','st_ctime_ns'))\n    if (digest!=expected['sha256'] or signature(before)!=signature(after)\n            or path.stat().st_ino!=after.st_ino):\n        raise ValueError('DEDUP_CONTENT_CHANGED')\n    return after\n\ndef plan_dedup(source, files, catalog, *, min_bytes=1024**2):\n    groups={}\n    for relative, value in files.items():\n        if (not isinstance(relative,str) or not relative.endswith('.json')\n                or not relative.startswith('reports/published/releases/')\n                or not isinstance(value,dict) or value.get('kind') not in (None,'file')\n                or type(value.get('bytes')) is not int or value['bytes']<min_bytes):\n            continue\n        match=re.fullmatch(r'reports/published/releases/(REL-[a-f0-9]{64})/(.+\\.json)',relative)\n        if '..' in Path(relative).parts or Path(relative).as_posix()!=relative:\n            raise ValueError('DEDUP_UNSAFE_PATH')\n        # Historical/pending directories are outside the immutable catalog scope.\n        # Their presence is neither corruption nor permission to rewrite them.\n        if not match:continue\n        release,name=match.groups()\n        if release not in catalog:continue\n        if catalog.get(release,{}).get(name)!=value.get('sha256'):\n            raise ValueError('DEDUP_CATALOG_MISMATCH')\n        key=tuple(value.get(k) for k in ('sha256','bytes','uid','gid','mode'))\n        groups.setdefault(key,[]).append({'relative':relative,'expected':dict(value)})\n    selected=[group for group in groups.values() if len(group)>1]\n    aliases={}\n    for group in selected:\n        for record in group:\n            info=_checked_file(source,record['relative'],record['expected'])\n            record['inode']=(info.st_dev,info.st_ino)\n            aliases.setdefault(record['inode'],[]).append(info)\n    if any(items[0].st_nlink!=len(items) for items in aliases.values()):\n        raise ValueError('DEDUP_EXTERNAL_LINK')\n    return selected\ntry:\n manifest=json.load(sys.stdin)\n source=Path('/state')\n with sqlite3.connect('file:/state/reports/published/publications.sqlite?mode=ro',uri=True) as db:catalog={rid:json.loads(files) for rid,files in db.execute('select release_id,files from publications')}\n groups=plan_dedup(source,manifest['files'],catalog)\n reclaimed=0\n for group in groups:\n  allocations={}\n  for record in group:\n   value=(source/record['relative']).stat();allocations[(value.st_dev,value.st_ino)]=value.st_blocks*512\n  reclaimed+=sum(allocations.values())-allocations[tuple(group[0]['inode'])]\n print(json.dumps({'live_dedup_plan':{'groups':len(groups),'files':sum(len(g) for g in groups),'physical_reclaimable_upper_bound':reclaimed,'status':'READ_ONLY_LIVE_PLAN'}}))\nexcept ValueError as error:\n code=str(error)\n print(json.dumps({'live_dedup_plan':{'status':'REJECTED','code':code if re.fullmatch('DEDUP_[A-Z_]+',code) else 'OTHER'}}));sys.exit(2)\n"
 manifest=Path('/home/aemr/.dash-private-backups/worker-38792810076/backup/manifest.json').read_text()
 result=subprocess.run(['docker','run','--rm','-i','--network','none','--read-only','--memory','512m','--pids-limit','32','--cpus','1','--cpu-shares','256','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--entrypoint','/usr/bin/timeout','--mount','type=volume,source=aemr_server_data,target=/state,readonly',image,'--kill-after=2s','150s','/opt/report-env/bin/python','-B','-c',program],input=manifest,capture_output=True,text=True,timeout=170,check=False)
 for line in result.stdout.splitlines():
  try:
   value=json.loads(line)
   if 'live_dedup_plan' in value:print(json.dumps(value),flush=True)
  except (ValueError,TypeError):pass
 print(json.dumps({'live_dedup_plan_exit':result.returncode}),flush=True)

def main():
 live_dedup_plan()
 recovery_preflight()
 print(json.dumps({"containers":snapshot(lambda args:subprocess.check_output(args,text=True,timeout=15))}),flush=True)
 for name in ("pending-release.json","release-recovery-progress.json","release-accepted.json","release-recovered.json"):
  path=Path("/var/lib/aemr")/name;result={"marker":name,"present":os.path.lexists(path)}
  if result["present"]:
   try:
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),"rb") as file:
     info=os.fstat(file.fileno());assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_size<=65536
     value=json.load(file)
    result["expected_source"]=value.get("release_sha",value.get("acceptance",{}).get("release_sha"))=="394c7e853a2b326b9a5c89ea52f60c51e075302e"
    result["phase"]=value.get("phase") if value.get("phase") in {"candidate_accept","runtime_resume"} else None
   except (OSError,ValueError,AssertionError,AttributeError):result["readable"]=False
  print(json.dumps(result),flush=True)
 for name in ("release-controller.log","release-recovery.log","watchdog.log","release-result","resume.log"):
  path=Path("/home/aemr/.dash-private-backups/worker-38792810076")/name
  result={"operational_file":name,"present":os.path.lexists(path)}
  if result["present"]:
   try:
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),"rb") as file:
     info=os.fstat(file.fileno());assert stat.S_ISREG(info.st_mode) and info.st_uid==0
     file.seek(max(0,info.st_size-65536));body=file.read(65536).decode("utf-8",errors="replace")
    result["bytes"]=info.st_size
    allowed={'RELEASE_TRIAL_PROOF_INVALID', 'RELEASE_RECOVERY_ARMED', 'RELEASE_RECOVERY_FAILED', 'RELEASE_NATIVE_WORD_MISMATCH', 'RELEASE_CANDIDATE_REJECTED_AND_RECOVERED', 'RELEASE_IMAGE_SOURCE_INVALID', 'RELEASE_PROOF_INVALID', 'RELEASE_COMMAND_FAILED', 'RELEASE_CHECKPOINT_CHANGED', 'RELEASE_CADDY_CAPSULE_CHANGED', 'RELEASE_SAVED_RUNTIME_MISMATCH', 'BACKUP_SPACE_BUDGET_ADMITTED', 'BACKUP_SPACE_BUDGET_UNAVAILABLE', 'BACKUP_WORKER_VOLUME_MISMATCH', 'RELEASE_VOLUME_WRITER_PRESENT', 'RELEASE_CONFIGURATION_STAGED', 'RELEASE_STAGE_INPUT_INVALID', 'RELEASE_CONTROLLER_FAILED', 'RELEASE_MODULE_PINS_INVALID', 'RELEASE_HANDOFF_INVALID', 'RELEASE_PREPARED_PLAN_INVALID', 'RELEASE_PROGRESS_INVALID', 'BACKUP_RUNTIME_RECORD_UNAVAILABLE', 'RELEASE_INGRESS_NOT_FENCED', 'RELEASE_CANDIDATE_ACCEPTED', 'RELEASE_TOOL_CHANGED', 'RELEASE_WORD_PROOF_INVALID', 'RELEASE_ACCEPTANCE_INVALID', 'RELEASE_CADDY_SOURCE_INVALID', 'RELEASE_SOURCE_CI_INVALID', 'RELEASE_BASE_PLAN_CREATED', 'RELEASE_RECOVERY_UNAVAILABLE', 'RELEASE_CANCEL_ADMITTED', 'RELEASE_RUNTIME_NOT_OWNED', 'BACKUP_GUARDIAN_NOT_READY', 'RELEASE_CONFIG_CHANGED', 'RELEASE_RUNTIME_RECOVERY_FAILED', 'RELEASE_LOCK_REQUIRED', 'RELEASE_ACCEPTED_RUNTIME_UNAVAILABLE', 'BACKUP_TARGET_EXISTS', 'BACKUP_SERVER_RESTART_FAILED', 'RELEASE_ALREADY_PENDING', 'RELEASE_IMAGE_UNAVAILABLE', 'RELEASE_ROLLBACK_IMAGE_UNAVAILABLE', 'RELEASE_STATE_RESTORE_FAILED', 'RELEASE_ALREADY_RECOVERED', 'RELEASE_OPERATOR_FILE_INVALID', 'BACKUP_PATH_OVERLAP', 'RELEASE_API_NOT_HEALTHY', 'RELEASE_PRIVATE_DIRECTORY_INVALID', 'BACKUP_GUARDIAN_FAILED', 'BACKUP_SERVER_NOT_HEALTHY', 'RELEASE_RESUME_REQUEST_QUEUED', 'RELEASE_BACKUP_SESSION_INVALID', 'BACKUP_WINDOW_ARGUMENTS_INVALID', 'RELEASE_RECEIPT_INVALID', 'RELEASE_RUNTIME_AND_STATE_RECOVERED', 'RELEASE_VOLUME_NOT_OWNED', 'RELEASE_CONFIG_INVALID', 'RELEASE_CANDIDATE_SCHEMA_INVALID', 'BACKUP_SPACE_BUDGET_INSUFFICIENT', 'RELEASE_CANDIDATE_STARTUP_INVALID', 'RELEASE_ROOT_REQUIRED', 'RELEASE_CANCEL_INVALID', 'RELEASE_COMPLETION_INVALID', 'RELEASE_STATE_RESTORE_UNVERIFIED', 'RELEASE_STAGE_INVALID', 'RELEASE_OWNED_FILE_INVALID', 'RELEASE_WRITER_NOT_QUIESCENT', 'RELEASE_BACKUP_UNSAFE', 'RELEASE_TRIAL_PREPARED'}
    result["codes"]=sorted(set(body.split())&allowed)
    if name=="release-result":result["outcome"]=int(body.strip()) if re.fullmatch(r"[0-9]{1,3}",body.strip()) and int(body.strip())<=255 else None
   except (OSError,ValueError,AssertionError):result["readable"]=False
  print(json.dumps(result),flush=True)
 processes=[]
 for proc in Path("/proc").glob("[0-9]*"):
  try:
   name=(proc/"comm").read_text().strip()
   if name not in {"python3","python","bash","sh","timeout","docker","node","flock"}:continue
   args=(proc/"cmdline").read_bytes().split(b"\0")
   known={"release-controller.py","report-backup-window.sh","release_guardian.py","runtime_guard.py","stateful_backup.py","header_api_probe.mjs"}
   operations=sorted({Path(a.decode(errors="replace")).name for a in args}&known)
   if not operations and name not in {"node","docker"}:continue
   info=(proc/"stat").read_text().rsplit(")",1)[1].split()
   processes.append({"pid":int(proc.name),"ppid":int(info[1]),"process":name,"operations":operations,"state":info[0],"cpu_ticks":int(info[11])+int(info[12])})
  except (OSError,ValueError,IndexError):pass
 print(json.dumps({"processes":processes}),flush=True)
 lock=Path("/run/lock/aemr-maintenance.lock").stat();holders=[]
 for path in Path("/proc").glob("[0-9]*/fdinfo/9"):
  try:
   pid=int(path.parts[2]);st=Path(f"/proc/{pid}/fd/9").stat()
   if (st.st_dev,st.st_ino)!=(lock.st_dev,lock.st_ino):continue
   text=path.read_text()
   if "FLOCK" not in text or "WRITE" not in text:continue
   name=Path(f"/proc/{pid}/comm").read_text().strip()
   holders.append({"pid":pid,"process":name if name in {"bash","sh","python","python3","flock","docker"} else "OTHER"})
  except (OSError,ValueError):pass
 for holder in holders:
  try:
   counters={}
   for line in Path('/proc/'+str(holder['pid'])+'/io').read_text().splitlines():
    key,value=line.split(':',1)
    if key in {'rchar','wchar','read_bytes','write_bytes'} and value.strip().isdigit():counters[key]=int(value.strip())
   holder['io_bytes']=counters
   fields=Path('/proc/'+str(holder['pid'])+'/stat').read_text().rsplit(')',1)[1].split()
   holder['cpu_ticks']=int(fields[11])+int(fields[12])
  except (OSError,ValueError,IndexError):pass
 print(json.dumps({'maintenance_holders':holders}),flush=True)
 counts={}
 for role in ("server","web","caddy","report-worker"):
  value=subprocess.check_output(["docker","ps","--all","--quiet","--no-trunc","--filter","label=com.docker.compose.project=aemr","--filter",f"label=com.docker.compose.service={role}","--filter","label=com.docker.compose.oneoff=False"],text=True,timeout=15)
  counts[role]=len(value.split())
 print(json.dumps({"same_filter_counts":counts}),flush=True)

if __name__=="__main__":main()
