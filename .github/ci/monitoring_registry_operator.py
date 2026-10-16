"""Run the accepted native monitoring migration without stopping API or worker."""
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SHA='43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa'
IMAGE='sha256:e5d8535fd30b9624cf0b3791cab447e326effe16fb847300837bc2e21024ec0d'
TOOLS=Path('/usr/local/libexec/aemr')
PHASE='LIFECYCLE'
NATIVE='''import fcntl,hashlib,json,os,signal,stat,sys
from pathlib import Path
assert os.getuid()==os.geteuid()==1000 and os.getgid()==os.getegid()==1000 and not os.getgroups()
caps=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert int(caps['CapEff'].strip(),16)==int(caps['CapAmb'].strip(),16)==0
info=os.fstat(9);assert (info.st_dev,info.st_ino)==tuple(json.loads(sys.argv[2]))
assert any('FLOCK  ADVISORY  WRITE' in ' '.join(line.split()) or 'FLOCK ADVISORY WRITE' in ' '.join(line.split()) for line in Path('/proc/self/fdinfo/9').read_text().splitlines())
if sys.argv[1]=='proof':
 os.write(int(sys.argv[3]),b'R');assert os.read(int(sys.argv[4]),1)==b'1';raise SystemExit(0)
signal.signal(signal.SIGALRM,lambda *_: (_ for _ in ()).throw(TimeoutError()))
signal.alarm(160)
assert Path.cwd()==Path('/app/packages/server')
import importlib.util
root=Path(importlib.util.find_spec('procurement_engine').origin).parent
expected={'__init__.py': 'cf4e30ee543ebfa92c2b63396910ca035d8bfd26b962c79b43e1d1cbcf2b3f84', 'action_spec.py': '94cfcfd1389a5b2415a1ee346b1607878c6d7b8cf7f9dbef892999c7cbfd921e', 'adapters.py': '152497a73895ac9674f751d6020fb46679250fcbaca711a4bebe6aa409f97afe', 'archive_runtime.py': '41e32f85d79d0d1d5aa2c5f579dba5d1aa4806a02870f862616eb3ed9a580bf5', 'archived_evidence.py': 'a4b49a873552e6919e26dc892e21abb515b924c015036bee1a61c1e1e481b30c', 'atomic_snapshot.py': 'd965c46f469684b499361c59ee9dae2ebbaaa38a2e5917966b2e7fa8af6ded7e', 'automation_assurance.py': '90a4b463f8565fd40777dc963ed3068e82c9d90a1a938ba090fb3e86d4886ce8', 'canonical_metrics.py': '163466a451cbaac6fb304daee32c4106adcd706f1502fe975140b216909e20cb', 'cli.py': '9b9920809b63f8ca67b6c11c0178832ba1d39b2e55d9f707ed6dbf12a9659799', 'constants.py': '580a79bb834e8af356572805be6fee219b8a4c7442cc940c573b3565dfda62bf', 'context.py': '199b3c657fc80e59f7284e00d68ad82d0185901b82f419c01d1ffc111fe7d20b', 'context_presentation.py': 'd046bb6c07b894e0581b492a46f3ce87688840609e6f61bcb1d93442d1f05b59', 'deployment_diagnostics.py': 'ac6c44d7405dcffdba93f258645fad05c1a4a606c86f67d658accc83f91e0c58', 'deployment_smoke.py': '2ef13df524856177177ede2ae83888da3fabc149fa3b414f2932e5a18a8452e7', 'diagnostics.py': 'efa67ce9e9d4c2d3bb68588bf3054a914aad0a4ed63fd064965a6ca4b0ec498f', 'diff.py': '8d5fe6d45259afcbb1d7579f55f75d85d9631724188182bdc271f169f14eb159', 'document_content.py': '4b20dcc248e68224afd810a7b36876c556c654f8c03b804d351792ba0959d156', 'document_plan.py': '0c84d404cee8f6b72449f29b23e80da0afeda6e185746017f54a80fd62973dba', 'docx_renderer.py': 'b67ac3a0b9c118aa9484b093e72f9ed6bd77a7a3c2418fc7a828dad2c87626a0', 'fact_model.py': '7a572eb4c3b9766b4345e13e9c171bfbafc2817e0c39408c6e82ff6a8cc51c49', 'formula_dependencies.py': 'bb9945fed9ccf56fb439d742b571897f99240e416b392c9bbe0557fc5cec7483', 'google_adapter.py': 'bf95e05fefb5881334b22f4e4b935e9e4ab1d823562a9587ab91093bd11175c2', 'identity.py': 'db46800aa550a8a717d51b5370fc80df8dfca5d8fea9b3099f5c180e63f4f505', 'identity_store.py': '4bdfcfc9acdf6f88ac9bdfeba7d0b5e4af623a8ea91837d6cac99f4ac9d3c054', 'independent_audit.py': 'd6bbae9b8b422b7fa1cff9433529c42f52dc0809e4af0a35d3eaf9782e5b4abb', 'input_contract.py': 'd92b9cc1fcfae1c7b5e734dae66b9f6f8b4ebecb1f8dfbb01af7288f0b1b1910', 'metrics.py': '580ee6451cdbf99238cfb286528b664de4d4fdf51e21623d0446e2ba8b19f560', 'models.py': 'e2a1755ec377e330fea1e9f65d7864a5aa714b29198b6817a8223655c16de6ce', 'monitoring_schema.py': 'd4feff139c32b1c91940cbbfffdfa0f0186662d6e8a8c5a7a5ef3b04e7f65fac', 'narrative.py': '305553d004a1689bf9a154d032b1c6e6b256505385e3891cc05853d74b460b40', 'normalize.py': '1b5d3f2eca1c9b77464ef45e887bfb13192be30ca2aed326e87675558a288f07', 'operational_casework.py': '5191992cdeb0b4cd453899a329631157830b8518fcacfae808f75021cbfaf2c6', 'operational_evidence.py': '6d9a91916b7cde2fcd37d52ea34c0ea858a0886a4744f9405e9dd5d121717b08', 'operational_plan.py': 'e661f1c10c7c3a3d166495875a08ea75047ba31c7243fd0e7cdcde63e9294c10', 'pipeline.py': '354e93086e969c97b6ec270f8ff11af9694156e9a507b1466f0e61eb47e695f5', 'procedures.py': 'a7969398b703fd12276ff65f62677aa5d49dbf363baef8a349d27a9d97454d68', 'projections.py': '682148d5d6b4156b855607b9400d8e090eec19949982e366dfc868222fbabcfe', 'publication_history.py': '65dd6f1ee5516ac20776d5908b8df9dfcac55efc6f4263ff3fe40e4ec0115b91', 'publication_reader.py': 'caa86f097cce4a2e2d5ff810fffc7733f4f59bec5bf0e2553ab55a93e9b16de9', 'publication_store.py': '35eb647ddd88b9d859efc08202355d451482bc01b09bf0c9ee213ec31ee9411f', 'qa.py': '6043da7c2f8f681998ef6c4a51a7cb74f2b3de329c479d0a2017c8dda09c1b84', 'raw_pipeline.py': '028530f13258bfd6b6e7fa15eb881fcd674597a198cca4b5f01df959342c257f', 'readonly_catalog.py': '0dd5ba8853c0ef8db229d23f545c915a4f0f0665046288d4def9ee1f297adeb0', 'recommendation_dimensions.py': 'ce78837f6069963ffee5d19846e44008797b974634095687a3281bd9e9bdcecb', 'recommendation_evidence.py': '72516ea6507b5b3e2b9793c7bbe8226b52c5b143ee96598afe0d1b6488541606', 'recommendation_history.py': '522f6821b851c5cccfa76085ef9d9d7dd5d4d9577ec88dbe7f67d0b1e19a97bf', 'recommendation_links.py': '5002c8374e2b24125171a3c3c859de553457f4878428063e86a0bc44747a8cf3', 'recommendation_strict.py': '49a79325aed4571efc00129792a56781e17b70d308509c6e9f88f3dab6bfb2ed', 'recommendations.py': 'daefe586aa2e006250e8bd4b4d9deed0c332b4cd8ddac2bb1e5844ba1db393d1', 'rehearsal.py': '241f1330113f43bc694f4e3b283d4d7b127b9d40b4d99f60984be2ebf6dcb39f', 'rehearsal_policy.py': '5fc657a4be44d438b6ec63503d412397c47306a37d964d781d6aa622f962d8d4', 'release_gates.py': '2c9e17219befec52cb59bda7b760dcead7e92d87b61b3fe138b74195322f732a', 'renderer_guard.py': '57e9365301a58cc43f2b686de0af242b7397340e1951ec745d6e4ed94aa756f9', 'report_content.py': '4e478cff251e1de2140065dfc3d051b185d0fe2852fb9feebcedb8470bbc89c6', 'report_health.py': 'eaa6a99641a397917a99c78a159d995c768b30163970b5e3a70c8a2937ace827', 'report_model.py': 'beea1bad902313e758046cb55ddcb85918adf5bcdd27d8a8a150b34bcedafc83', 'retention.py': '7bb456dcdf93e6e4887a065a6da6fb5690916d302b3b84b15c7c7055b2fa2628', 'rule_catalog.py': '245a94162cf79ff982d14e6c8dadc2cb0b269403493ab3a65e38fcde57de34c0', 'runtime.py': '09e00c7e11c34ab1af4613b5ad34fdb8ce940c0c216b4fcb64c40a59bac1f3a9', 'runtime_inputs.py': '27d1b0bc31849296a7e2d36c22c83e4d935ddc05b3cc5eeac6db8b1f140fc45c', 'schema_migrations.py': '5ae0451d50eaaf9422e5e1d3f4177a97e4b7e80380236682ad3d505ca7486525', 'section_audit.py': '9a3fd82f0a822ab05ee48d179d789ec0837fcd4f86b9e95bd206cb0460ed8b74', 'semantic_headers.py': '3704f12ce7ffc26b98f2e07366b4a65082a14df1f8c5882b35d97513f7740d71', 'snapshot.py': '80dc2b75cb6bf3977e5bb48ff75dfd2003d50fa4dfc1ad7410951ae8066483b1', 'snapshot_bundle_io.py': '75c32a84e06881fa959af493d394b8dcc1cc97453b96e32d4e5415b55c8a8c67', 'source_context.py': '4a98381cbf685e642823a79a02cef54a5b30ecea6a429cfef2f159b3f2bde3e5', 'source_contract.py': '0d7aaa5ee7d509300c503275c66530322123953bf2fe81ee7a11e0c3fec2ec55', 'storage_inventory.py': '9b3abd54012966d1d0170c707f2d6baa76b1553c0283c40e7f836c210d7a232b', 'traceability.py': 'ad97a275f206e80abc7099b7d97ee8b15229e0b35024e7977e00f539415b9fc3', 'validation.py': '13cadfc307f843da7ece5ea3eec2a65ad84e7d30b975653b29c78b588a5f5150', 'weekly_archive.py': 'a76c80da8cb0000a1003061164da1de94e881b97c9981a82a0502902d6a53766', 'weekly_evidence.py': '69dc030864b76f2c9c1399497ed7e1ff53b12d7f463aebb3bc28ace8978f7a1a', 'worker.py': '6aae96cbb964d446da3f02ea10283af4576ea1644d1c643407b06f29c4c6b2f2', 'xlsx_raw.py': '2627b977d1d465728f9360a39764e42a2711e383041d7ea3c0d2e4458ba3d9af'}
assert not any(p.is_symlink() for p in root.rglob('*'))
assert {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*.py')}==expected
from procurement_engine.monitoring_schema import apply_monitoring_schema
from procurement_engine.runtime_inputs import validate_inputs
from procurement_engine.snapshot import canonical_semantic_hash
state=Path('data/reports');path=state/'inputs/registry.json'
with os.fdopen(os.open(state/'run.lock',os.O_RDWR|os.O_NOFOLLOW),'r+') as lock:
 metadata=os.fstat(lock.fileno());assert stat.S_ISREG(metadata.st_mode) and metadata.st_uid==1000 and metadata.st_nlink==1
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 before=json.loads(path.read_text());previous=canonical_semantic_hash(before)
 changed=apply_monitoring_schema(path,state)
 after=json.loads(path.read_text());validate_inputs(after,json.loads((state/'inputs/ledger.json').read_text()))
 matches=[s for s in after['sources'] if s['sheet_id']==837564274 and s['provider_id']=='1wET-yUf9OQGTgPWSs96xAE3X7WSrVejtVGWRH1pv-1E']
 assert len(matches)==1 and matches[0]['columns']==34
 assert changed==0 or json.loads((state/'inputs/registry-history'/(previous+'.json')).read_text())==before
 print(json.dumps({'monitoring_migration':'PASS','changes':changed,'columns':34,'previous_registry':previous,'current_registry':canonical_semantic_hash(after),'history_preserved':True}),flush=True)
'''
SUPERVISOR='''import os,subprocess,sys
p=subprocess.Popen(sys.argv[4:],pass_fds=(9,int(sys.argv[1]),int(sys.argv[2])),close_fds=True)
os.write(int(sys.argv[3]),str(p.pid).encode());os.close(int(sys.argv[3]));raise SystemExit(p.wait())
'''


def owned(path):
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        info=os.fstat(stream.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and not info.st_mode&0o022 and info.st_size<=1024*1024
        return stream.read()


def native_environment(values):
    result=dict(item.split('=',1) for item in values)
    result={key:value for key,value in result.items() if not key.startswith('LD_') and key not in {'PYTHONHOME','PYTHONPATH'}}
    result['PYTHONDONTWRITEBYTECODE']='1'
    return result


def namespace_command(record,mode,identity,*extra):
    return ['/usr/bin/nsenter','--target',str(record['State']['Pid']),'--mount','--net','--pid','--root','--wd',
            '--setuid','1000','--setgid','1000','/opt/report-env/bin/python','-IB','-c',NATIVE,mode,json.dumps(identity),*map(str,extra)]


def prove_owner_loss(record,env,directory):
    with tempfile.TemporaryDirectory(prefix='lock-proof-',dir=directory) as temporary:
        path=Path(temporary)/'lock';fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600)
        if fd!=9:os.dup2(fd,9,inheritable=True);os.close(fd)
        fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
        info=os.fstat(9);identity=(info.st_dev,info.st_ino)
        ready_r,ready_w=os.pipe();release_r,release_w=os.pipe();pid_r,pid_w=os.pipe()
        command=namespace_command(record,'proof',identity,ready_w,release_r)
        diagnostic=(Path(directory)/'proof-diagnostic.log').open('x')
        owner=subprocess.Popen([sys.executable,'-IB','-c',SUPERVISOR,str(ready_w),str(release_r),str(pid_w),*command],
                               pass_fds=(9,ready_w,release_r,pid_w),env=env,stdout=subprocess.DEVNULL,stderr=diagnostic)
        diagnostic.close()
        os.close(9);os.close(ready_w);os.close(release_r);os.close(pid_w)
        try:
            import select
            assert select.select([ready_r],[],[],15)[0] and os.read(ready_r,1)==b'R'
            assert select.select([pid_r],[],[],2)[0];child=int(os.read(pid_r,32))
            inherited=Path('/proc')/str(child)/'fd/9';assert (inherited.stat().st_dev,inherited.stat().st_ino)==identity
            os.kill(owner.pid,signal.SIGKILL);assert owner.wait(timeout=5)==-signal.SIGKILL
            with path.open('r+') as competitor:
                try:fcntl.flock(competitor,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:pass
                else:raise AssertionError('CHILD_CUSTODY_NOT_RETAINED')
            os.write(release_w,b'1');os.close(release_w);release_w=None
            deadline=time.monotonic()+5
            with path.open('r+') as competitor:
                while True:
                    try:fcntl.flock(competitor,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                    except BlockingIOError:
                        assert time.monotonic()<deadline
                        time.sleep(.05)

        finally:
            for descriptor in (ready_r,pid_r,release_w):
                if descriptor is not None:os.close(descriptor)
            if owner.poll() is None:owner.terminate();owner.wait(timeout=5)
    print('NATIVE_NAMESPACE_UID_CAPS_AND_OWNER_LOSS_PASS',flush=True)


def accepted():
    raw=json.loads(owned(Path('/var/lib/aemr/release-runtime/trial-plan.json')))
    assert raw['release_sha']==SHA
    reference=raw['backup_reference'];assert re.fullmatch('worker-[0-9]+/backup',reference)
    window=json.loads(owned(Path('/home/aemr/.dash-private-backups')/Path(reference).parent/'release-window.json'))
    pins=window['module_sha256'];assert set(pins)=={'release-controller.py','release_recovery.py','release_trial.py','stateful_backup.py','source_ci_gate.py'}
    assert all(hashlib.sha256(owned(TOOLS/name)).hexdigest()==digest for name,digest in pins.items())
    sys.path.insert(0,str(TOOLS))
    import release_recovery as r
    r.require_lock(9)
    plan=r.validate_plan(raw)
    assert plan['release_sha']==SHA and plan['candidate_images']['server']==plan['candidate_images']['report-worker']==IMAGE
    receipt=json.loads(owned(r.STATE_DIR/'release-accepted.json'))
    assert receipt=={'plan_sha256':r.digest(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()),'acceptance':r.ReleaseRecovery._acceptance(plan)}
    assert not any(os.path.lexists(r.STATE_DIR/name) for name in ('pending-release.json','release-recovery-progress.json'))
    executor=r.ReleaseRecovery(lock_fd=9);records=executor._records(plan,candidate=True)
    spec=importlib.util.spec_from_file_location('accepted_controller',TOOLS/'release-controller.py');controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
    _,config=executor._files(plan,candidate_runtime=True)
    controller.ReleaseController(executor)._saved_runtime({**plan,'images':plan['candidate_images']},records,json.loads(json.dumps(config).replace('$$','$')))
    record=records['server'];assert record['State']['Status']=='running' and record['State']['Health']['Status']=='healthy'
    return record


def main():
    global PHASE
    assert os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1] in {'proof','apply'} and re.fullmatch('[0-9]+',sys.argv[2])
    unit='aemr-monitoring-registry-'+sys.argv[2]+'.service'
    properties=subprocess.check_output(['systemctl','show',unit,'--property=MainPID,KillMode,ExitType'],text=True)
    assert dict(line.split('=',1) for line in properties.splitlines())=={'MainPID':str(os.getpid()),'KillMode':'process','ExitType':'cgroup'}
    assert unit in Path('/proc/self/cgroup').read_text().strip().split('/')
    PHASE='RUNTIME'
    record=json.loads(subprocess.check_output(['docker','inspect','aemr-server-1'],text=True))[0]
    assert record['Image']==IMAGE and record['State']['Running'] and record['State']['Pid']>0
    assert record['Config']['Labels']['com.docker.compose.project']=='aemr'
    env=native_environment(record['Config']['Env'])
    directory=Path(__file__).resolve().parent
    PHASE='ISOLATED_PROOF'
    prove_owner_loss(record,env,directory)
    if sys.argv[1]=='proof':return
    PHASE='GLOBAL_LOCK'
    descriptor=os.open('/run/lock/aemr-maintenance.lock',os.O_RDWR|os.O_NOFOLLOW)
    info=os.fstat(descriptor);assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1
    if descriptor!=9:os.dup2(descriptor,9,inheritable=True);os.close(descriptor)
    with os.fdopen(9,'r+'):
        fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
        PHASE='ACCEPTED_CONTEXT'
        current=accepted();assert current['Id']==record['Id'] and current['State']['Pid']==record['State']['Pid']
        PHASE='NATIVE_MIGRATION'
        result=subprocess.run(namespace_command(record,'apply',(info.st_dev,info.st_ino)),env=env,pass_fds=(9,),capture_output=True,text=True,check=False)
        if result.returncode:
            Path(__file__).with_name('native-diagnostic.log').write_text(result.stderr[-1024*1024:])
        assert result.returncode==0
        PHASE='READBACK'
        value=json.loads(result.stdout);assert value['monitoring_migration']=='PASS' and type(value['changes']) is int and 0<=value['changes']<=20
        assert value['columns']==34 and value['history_preserved'] is True
        assert all(re.fullmatch('[a-f0-9]{64}',value[key]) for key in ('previous_registry','current_registry'))
        print(json.dumps(value),flush=True)


if __name__=='__main__':
    try:main()
    except Exception:  # noqa: BLE001 - private messages never cross public output
        import traceback
        Path(__file__).with_name('diagnostic.log').write_text(traceback.format_exc())
        print('NATIVE_REGISTRY_BLOCKED_'+PHASE,flush=True);raise SystemExit(2) from None
