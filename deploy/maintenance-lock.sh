# Source from maintenance scripts. fd9 is inherited only after kernel verification.
maintenance_lock_owned_by() {
  python3 - "$1" <<'PY'
import os,sys,stat
try:
    pid=int(sys.argv[1]); st=os.stat(f'/proc/{pid}/fd/9')
    target=os.lstat('/run/lock/aemr-maintenance.lock')
    assert stat.S_ISREG(target.st_mode)
    assert (st.st_dev,st.st_ino)==(target.st_dev,target.st_ino)
    found=False
    for line in open(f'/proc/{pid}/fdinfo/9'):
        f=line.split()
        if f and f[0]=='lock:': f=f[1:]
        if len(f)==8 and f[1:4]==['FLOCK','ADVISORY','WRITE']:
            major,minor,inode=f[5].split(':')
            found |= (int(major,16),int(minor,16),int(inode))==(os.major(st.st_dev),os.minor(st.st_dev),st.st_ino)
    assert found
except (OSError,ValueError,AssertionError):
    sys.exit(1)
PY
}
maintenance_lock_acquire() {
  # fdinfo is kernel evidence for this open file description, including inherited
  # locks whose original flock(1) owner has exited. No environment flag is trusted.
  if maintenance_lock_owned_by $$; then return 0; fi
  [ ! -L /run/lock/aemr-maintenance.lock ] || { echo AEMR_MAINTENANCE_LOCK_INVALID >&2; return 1; }
  exec 9>/run/lock/aemr-maintenance.lock
  flock -n 9 || { echo 'AEMR_MAINTENANCE_BUSY' >&2; return 1; }
}
