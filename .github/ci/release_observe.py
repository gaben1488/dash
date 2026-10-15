import json
import os
import re
import stat
import subprocess
from pathlib import Path

SERVICES={"/aemr-"+name+"-1":name for name in ("server","web","caddy","report-worker")}
OPERATIONS={"match-source","restore-state","restore-reports","initialize-publication-readers"}
def safe_record(value):
 state=value.get("State",{});config=value.get("Config",{});image=value.get("Image","")
 return {"service":SERVICES.get(value.get("Name"),"OTHER"),
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
if __name__=="__main__":main()
