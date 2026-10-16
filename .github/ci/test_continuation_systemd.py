"""Actual isolated systemd owner-loss proof, exclusively on an ephemeral runner."""
import fcntl
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from continue_release import custodians

PROGRAM = '''import fcntl,os,sys,time
from pathlib import Path
root=Path(sys.argv[1]);fd=os.open(root/'lock',os.O_RDWR|os.O_CREAT,0o600)
fcntl.flock(fd,fcntl.LOCK_EX);os.dup2(fd,9,inheritable=True)
parent=os.getpid();child=os.fork()
if child==0:
 (root/'guardian').write_text(str(os.getpid()))
 until=time.monotonic()+20
 while os.getppid()==parent and time.monotonic()<until:time.sleep(0.05)
 if os.getppid()!=parent:
  (root/'recovering').touch();time.sleep(3);(root/'recovered').touch()
 os._exit(0)
(root/'main').write_text(str(parent))
while True:time.sleep(1)
'''


def command(arguments, *, check=True):
    result=subprocess.run(arguments,capture_output=True,text=True,timeout=15,check=False)
    if check and result.returncode:raise RuntimeError('ISOLATED_CUSTODY_COMMAND_FAILED')
    return result


def wait(path, seconds=8):
    until=time.monotonic()+seconds
    while not path.exists() and time.monotonic()<until:time.sleep(0.05)
    return path.exists()


def lock_available(path):
    with path.open('r+') as stream:
        try:fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return False
        return True


def main():
    assert os.geteuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_OS')=='Linux'
    for process_mode in (False,True):
        unit='aemr-isolated-custody-'+str(os.getpid())+('-process' if process_mode else '-default')
        with tempfile.TemporaryDirectory(prefix='aemr-isolated-custody-') as temporary:
            root=Path(temporary);script=root/'child.py';script.write_text(PROGRAM)
            try:
                arguments=['systemd-run','--quiet','--collect','--unit',unit,'--property','Type=exec']
                if process_mode:arguments+=['--property','KillMode=process']
                command([*arguments,sys.executable,str(script),str(root)])
                assert wait(root/'main') and wait(root/'guardian') and not lock_available(root/'lock')
                command(['systemctl','kill','--kill-whom=main','--signal=SIGKILL',unit+'.service'])
                if process_mode:
                    assert wait(root/'recovering'), 'MAIN_LOSS_KILLED_RECOVERY_GUARDIAN'
                    assert not lock_available(root/'lock'), 'RECOVERY_LOST_EXCLUSION_AFTER_OWNER_DEATH'
                    holders=None;until=time.monotonic()+2
                    while holders is None and time.monotonic()<until:holders=custodians((root/'lock').stat())
                    assert holders is not None and int((root/'guardian').read_text()) in holders, 'LIVE_INHERITED_CUSTODY_NOT_DETECTED'
                    assert wait(root/'recovered')
                    until=time.monotonic()+5
                    while not lock_available(root/'lock') and time.monotonic()<until:time.sleep(0.05)
                    assert lock_available(root/'lock')
                    print('ISOLATED_PROCESS_CUSTODY_SURVIVES_MAIN_LOSS_PASS',flush=True)
                else:
                    time.sleep(3)
                    assert not (root/'recovered').exists() and lock_available(root/'lock')
                    print('ISOLATED_DEFAULT_CGROUP_KILLS_GUARDIAN_CONFIRMED',flush=True)
            finally:
                command(['systemctl','kill','--kill-whom=all','--signal=SIGKILL',unit+'.service'],check=False)
                command(['systemctl','stop',unit+'.service'],check=False)
                guardian=root/'guardian'
                if guardian.exists():
                    pid=int(guardian.read_text())
                    try:
                        # PID identity must still be the exact isolated script.
                        args=Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0')
                        if str(script).encode() in args:os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    except FileNotFoundError:pass


if __name__=='__main__':main()
