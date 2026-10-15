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
def main():
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
 print(json.dumps({"maintenance_holders":holders}),flush=True)
 counts={}
 for role in ("server","web","caddy","report-worker"):
  value=subprocess.check_output(["docker","ps","--all","--quiet","--no-trunc","--filter","label=com.docker.compose.project=aemr","--filter",f"label=com.docker.compose.service={role}","--filter","label=com.docker.compose.oneoff=False"],text=True,timeout=15)
  counts[role]=len(value.split())
 print(json.dumps({"same_filter_counts":counts}),flush=True)
 database=Path("/var/lib/docker/volumes/aemr_server_data/_data/aemr.db")
 assert database.is_file() and not any(p.is_symlink() for p in (database,*database.parents))
 assert all(not Path(str(database)+suffix).is_symlink() for suffix in ("-wal","-shm"))
 print(json.dumps({"snapshot_database_sizes":{name:Path(str(database)+suffix).stat().st_size if Path(str(database)+suffix).is_file() else None for name,suffix in (("main_bytes",""),("wal_bytes","-wal"))}}),flush=True)
 expected="sha256:545fd2b3cf69d73f22cd4a3639d51b37dab582f6bf2e92e78075d22f7be59d25"
 record=json.loads(subprocess.check_output(["docker","inspect","aemr-server-1"],text=True,timeout=15))[0]
 assert record["Image"]==expected and record["State"]["Status"]=="running"
 mounts=[m for m in record.get("Mounts",[]) if m.get("Destination")=="/app/packages/server/data"]
 assert len(mounts)==1 and mounts[0].get("Type")=="volume" and mounts[0].get("Name")=="aemr_server_data" and mounts[0].get("Source")==str(database.parent)
 program='import json,re,sqlite3,time\nfrom pathlib import Path\npath=Path(\'/state/aemr.db\')\nassert all(not p.is_symlink() for p in (path,Path(str(path)+\'-wal\'),Path(str(path)+\'-shm\')))\nassert path.is_file() and Path(str(path)+\'-shm\').is_file()\nconnection=sqlite3.connect(\'file:/state/aemr.db?mode=ro\',uri=True,timeout=2)\ndeadline=time.monotonic()+5\nconnection.set_progress_handler(lambda:int(time.monotonic()>deadline),10000)\nsizes={}\ndef number(value):return value if type(value) is int and 0<=value<=2**53-1 else None\ntry:\n connection.execute(\'PRAGMA query_only=ON\')\n sizes[\'snapshots\']=number(connection.execute(\'SELECT COUNT(*) FROM snapshots\').fetchone()[0])\n sizes[\'recent\']=[]\n for created,read_ms,pipeline_ms,rows,issues in connection.execute(\'SELECT created_at,read_duration_ms,pipeline_duration_ms,row_count,issue_count FROM snapshots ORDER BY created_at DESC LIMIT 5\'):\n  at=created if isinstance(created,str) and re.fullmatch(r\'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(?:Z|[+-][0-9]{2}:[0-9]{2})\',created) else None\n  sizes[\'recent\'].append({\'at\':at,\'read_ms\':number(read_ms),\'pipeline_ms\':number(pipeline_ms),\'rows\':number(rows),\'issues\':number(issues)})\n sizes[\'nonopen_or_commented\']=number(connection.execute("SELECT COUNT(*) FROM issues WHERE status <> \'open\' OR length(trim(coalesce(comment,\'\')))>0").fetchone()[0])\nexcept sqlite3.Error:sizes[\'query_incomplete\']=True\nfinally:connection.close()\nprint(json.dumps({\'snapshot_runtime_metadata\':sizes}),flush=True)\n'
 result=subprocess.run(["docker","run","--rm","-i","--network","none","--read-only","--memory","128m","--pids-limit","32","--cpus","0.25","--cap-drop","ALL","--security-opt","no-new-privileges","--user","1000:1000","--entrypoint","/usr/bin/timeout","--mount","type=volume,source=aemr_server_data,target=/state,readonly",expected,"--kill-after=2s","25s","python3","-B","-"],input=program,capture_output=True,text=True,timeout=40,check=False)
 for line in result.stdout.splitlines():
  try:
   value=json.loads(line)
   if "snapshot_runtime_metadata" in value:print(json.dumps(value),flush=True)
  except (ValueError,AttributeError):pass
 print(json.dumps({"metadata_reader_exit":result.returncode}),flush=True)
if __name__=="__main__":main()
