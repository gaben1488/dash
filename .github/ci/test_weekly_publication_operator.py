"""Host adapter boundaries; all process tests use their own temporary lock."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class WeeklyOperatorTests(unittest.TestCase):
    def test_host_setup_does_not_require_ensurepip_or_install_into_system_python(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        setup=textwrap.dedent(workflow.split("<<'SHSETUP'\n",1)[1].split('\n          SHSETUP',1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);binaries=root/'bin';binaries.mkdir()
            interpreter=binaries/'python3'
            interpreter.write_text('#!/bin/sh\n'
                'if [ "$1" = -IB ]; then cat >/dev/null; exit 0; fi\n'
                '[ "$1 $2 $3 $4" = "-m venv --without-pip --copies" ] || exit 8\n'
                'mkdir -p "$5/bin"\n'
                'cp "$FAKE_VENV_PYTHON" "$5/bin/python"\n')
            interpreter.chmod(0o700)
            child=root/'child'
            child.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_TRACE"\n')
            child.chmod(0o700)
            trace=root/'trace'
            # Existing setup deliberately fixes PATH. The fixture substitutes
            # only that line so the host has venv, but no implicit ensurepip.
            setup=setup.replace('PATH=/usr/sbin:/usr/bin:/sbin:/bin',f'PATH={binaries}:/usr/bin:/bin')
            env={**os.environ,'FAKE_VENV_PYTHON':str(child),'BOOTSTRAP_TRACE':str(trace)}
            result=subprocess.run(['/bin/bash','-s','--',str(root)],input=setup,text=True,
                                  env=env,capture_output=True,timeout=10,check=False)
            self.assertEqual(result.returncode,0,'Host venv creation must work without ensurepip')
            commands=trace.read_text().splitlines()
            self.assertIn(str(root/'get-pip.py'),commands[0])
            self.assertIn('--only-binary=:all:',commands[0])
            self.assertIn('-m pip --isolated',commands[1])
            self.assertEqual((root/'setup.phase').read_text().strip(),'VERIFY')

    def test_live_apply_transport_requires_a_literal_reviewed_revision(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        self.assertTrue("'compaction-apply'" in workflow,"Missing guarded apply transport")
        script=workflow[workflow.index("            command=['systemd-run'"):]
        script=textwrap.dedent(script[:script.index('            result=subprocess.run(command')])
        scope={'unit':'aemr-weekly-compaction-42.service','root':Path('/private/run'),
               'run':'42','python':Path('/private/tool/venv/bin/python'),'path':Path('/private/run/operator.py'),
               'stage':Path('/private/tool'),'site':'/private/tool/site','mode':'compaction-apply','re':re}
        # Until a real preflight is independently reviewed, an apply request
        # cannot reuse the read-only live marker as an authorization token.
        unbound=re.sub(r"revision='[^']*'","revision='PREFLIGHT_REQUIRED'",script)
        with self.assertRaises(AssertionError):
            exec(unbound,dict(scope))  # noqa: S102 - trusted local workflow argv, no process calls
        bound=unbound.replace("revision='PREFLIGHT_REQUIRED'","revision='"+'f'*64+"'")
        exec(bound,scope)  # noqa: S102 - trusted local workflow argv, no process calls
        command=scope['command']
        self.assertNotIn('--check',command)
        self.assertEqual(command[command.index('--expected-revision')+1],'f'*64)
        self.assertEqual(command[command.index('--operation')+1],'apply')
        self.assertIn('--property',command)
        self.assertIn('KillMode=process',command)
        self.assertIn('ExitType=cgroup',command)
        scope['mode']='plan'
        exec(script,scope)  # noqa: S102 - trusted local workflow argv, no process calls
        self.assertIn('--check',scope['command'])
        self.assertEqual(scope['command'][scope['command'].index('--expected-revision')+1],'live')

    def setUp(self):
        path = Path(__file__).with_name('weekly_publication_operator.py')
        self.assertTrue(path.is_file(), 'Missing minimal existing-CLI host adapter')
        spec = importlib.util.spec_from_file_location('weekly_publication_operator', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_heavy_native_readback_is_isolated_and_cleans_only_its_created_container(self):
        self.assertTrue(hasattr(self.module,'native_readback'),'Heavy checker must not run inside the API process budget')
        for failed in (False,True):
            calls=[];container='a'*64
            def run(arguments,*,calls=calls,container=container,failed=failed,**options):
                calls.append((arguments,options))
                if arguments[1]=='create':return (container+'\n').encode()
                if arguments[1]=='start':
                    if failed:raise ValueError('OPERATOR_COMMAND_FAILED')
                    return b'{"proof":true}'
                return b''
            with self.subTest(failed=failed),patch.object(self.module,'call',side_effect=run):
                if failed:
                    with self.assertRaises(ValueError):self.module.native_readback('sha256:'+'b'*64,'aemr_server_data',b'code',{'plan':1})
                else:self.assertEqual(self.module.native_readback('sha256:'+'b'*64,'aemr_server_data',b'code',{'plan':1}),b'{"proof":true}')
            create=calls[0][0]
            for flag in ('--read-only','--network','--memory','--memory-swap','--cpus'):self.assertIn(flag,create)
            self.assertIn('none',create);self.assertIn('768m',create)
            self.assertIn('type=volume,src=aemr_server_data,dst=/app/packages/server/data,readonly',create)
            self.assertEqual(calls[-1][0],['docker','rm','--force',container])
            self.assertEqual(json.loads(calls[1][1]['input_bytes']),{'plan':1})

    def context(self):
        sha = self.module.SHA
        plan = {'release_sha':sha, 'backup_reference':'worker-38831492016/backup',
                'candidate_images':{'server':'sha256:'+'a'*64,'report-worker':'sha256:'+'a'*64}}
        records = {name:{'Id':name+'-id','Image':plan['candidate_images'][name],
                    'State':{'Status':'running','StartedAt':'start','OOMKilled':False,
                             'Health':{'Status':'healthy'}}} for name in ('server','report-worker')}
        cycle = {'state':'TWO_AUTONOMOUS_CYCLES_VERIFIED','source_sha':sha,
                 'worker':'report-worker-id','worker_image':plan['candidate_images']['report-worker'],
                 'worker_started_at':'start','native_word':'PASS',
                 'attempt_ids':['first','second'],'sealed_entries_verified':10}
        native = {name:{'uid':1000,'hashes':{'__init__.py':'f'*64},
                       'lease_uid':1000,'lease_regular':True,'symlinks':False}
                  for name in records}
        ci = {'id':42,'head_sha':self.module.TOOL_SHA,'status':'completed','conclusion':'success','name':'CI',
              'head_repository':{'full_name':'gaben1488/dash'}}
        return plan,records,cycle,native,{'__init__.py':'f'*64},ci

    def test_maintenance_source_and_installed_runtime_are_separately_pinned(self):
        prefix='packages/report-engine/src/procurement_engine/'
        runtime={prefix+'identity_store.py':'a'*64,'deploy/stateful_backup.py':'b'*64}
        runtime.update({name:'c'*64 for name in self.module.TOOL_DIFFERENCES})
        tool=dict(runtime)
        tool.update({name:'d'*64 for name in self.module.TOOL_DIFFERENCES})
        tool[self.module.SOURCE_CI_HELPER]='f'*64
        manifest={'candidate':self.module.SHA,'hashes':runtime}
        expected={name[len(prefix):]:value for name,value in runtime.items() if name.startswith(prefix)}
        self.assertEqual(self.module.runtime_hashes(manifest,tool),expected)
        for failure in ('candidate','identity','backup','missing','extra','omitted_difference'):
            with self.subTest(failure=failure):
                changed=copy.deepcopy(manifest)
                if failure=='candidate':changed['candidate']=self.module.TOOL_SHA
                if failure=='identity':changed['hashes'][prefix+'identity_store.py']='e'*64
                if failure=='backup':changed['hashes']['deploy/stateful_backup.py']='e'*64
                if failure=='missing':changed['hashes'].pop(prefix+'identity_store.py')
                if failure=='extra':changed['hashes'][prefix+'unexpected.py']='e'*64
                if failure=='omitted_difference':changed['hashes'][prefix+'publication_store.py']=tool[prefix+'publication_store.py']
                with self.assertRaises(ValueError):self.module.runtime_hashes(changed,tool)

    def test_source_job_qualification_preserves_failed_live_result_and_rejects_bad_sources(self):
        args=list(self.context());ci=args[-1]
        ci.update(conclusion='failure',event='pull_request',path='.github/workflows/ci.yml')
        ci['source_jobs']=[{'run_id':ci['id'],'name':name,'status':'completed','conclusion':'success'} for name in (
            'Lint, TypeScript, Tests, Build, Audit','Report engine, publication and runtime','Production image with report runtime')]
        self.module.validate_context(*args,backup_reference='worker-38831492016/backup')
        self.assertEqual(ci['conclusion'],'failure')
        ci['source_jobs'][0]['run_id']+=1
        with self.assertRaises(ValueError):self.module.validate_context(*args,backup_reference='worker-38831492016/backup')

    def test_old_runtime_failed_ci_cannot_be_presented_as_tool_ci(self):
        args=list(self.context())
        args[-1].update(head_sha=self.module.SHA,conclusion='failure')
        with self.assertRaises(ValueError):
            self.module.validate_context(*args,backup_reference='worker-38831492016/backup')

    def test_readonly_plan_is_private_and_does_not_invoke_an_operation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)/'source';deploy=root/'deploy';deploy.mkdir(parents=True)
            (deploy/'plan-weekly-publications.py').write_text(
                'def plan(state):\n raise AssertionError("duplicate standalone plan")\n'
                'def operator_preflight(state,**kw):\n assert kw["expected_revision"]=="live" and kw["operation"]=="apply"\n return {"plan":'+repr({'catalog_revision':'f'*64,'publication_count':98,
                'keep_count':8,'retire_count':90,'bytes_reclaimable_upper_bound':1000,
                'retire_release_ids':['private-id'],'identity_ready':True})+'}\n'
                'def operate(*a,**kw):\n raise AssertionError("unexpected mutation")\n')
            ci=root/'ci.json';ci.write_text('{}');receipt=root/'receipt.json';receipt.write_text('{}')
            result=self.module.preview_plan(root,Path(sys.executable),[],root/'state',backup=root/'backup',
                ci_evidence=ci,source_receipt=receipt,reader_package=root/'reader')
            self.assertEqual(result['catalog_revision'],'f'*64)
            self.assertEqual(result['retire_count'],90)
            self.assertNotIn('retire_release_ids',result)
            saved=root.parent/'retention-plan.json'
            # The staging root is tree.parent in production; isolate it here.
            self.assertEqual(json.loads(saved.read_text())['retire_release_ids'],['private-id'])
            self.assertEqual(saved.stat().st_mode&0o777,0o600)
            saved.unlink()

    def test_host_scratch_is_on_the_admitted_disk_and_removed_after_child_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary)/'scratch';sibling=Path(temporary)/'unrelated';sibling.write_text('keep')
            before=self.module.ENV.copy()
            actual_lstat=Path.lstat
            def trust_only_root_fixture(path):
                value=actual_lstat(path)
                return SimpleNamespace(st_mode=value.st_mode,st_uid=0,st_nlink=value.st_nlink) if path==base else value
            with patch.object(self.module,'SCRATCH',base),patch.object(Path,'lstat',trust_only_root_fixture):
                with self.assertRaisesRegex(ValueError,'synthetic'),self.module.owner_scratch('123') as folder:
                    self.assertEqual(folder.parent,base)
                    self.assertEqual((folder.stat().st_uid,folder.stat().st_gid,folder.stat().st_mode&0o777),(1000,1000,0o700))
                    child='import tempfile;print(tempfile.gettempdir())'
                    self.assertEqual(self.module.call([sys.executable,'-IB','-c',child]).decode().strip(),str(folder))
                    (folder/'disposable.sqlite').write_bytes(b'disposable copy')
                    raise ValueError('synthetic')
                self.assertFalse(folder.exists())
                self.assertEqual(sibling.read_text(),'keep')
                self.assertEqual(self.module.ENV,before)
                with self.assertRaisesRegex(ValueError,'custodian'),self.module.owner_scratch('124',preserve_on_error=True) as retained:
                    (retained/'recovery.sqlite').write_bytes(b'custodian still needs this')
                    raise ValueError('custodian')
                self.assertTrue((retained/'recovery.sqlite').exists())
                self.assertEqual(self.module.ENV,before)

    def test_busy_guard_lock_is_waited_for_without_replacing_its_inode(self):
        import fcntl
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'lock';path.touch();inode=path.stat().st_ino
            with path.open('r+') as held,path.open('r+') as waiting:
                fcntl.flock(held,fcntl.LOCK_EX)
                with self.assertRaises(BlockingIOError):self.module.acquire_lock(waiting.fileno(),timeout=0)
                release=threading.Timer(0.05,lambda:fcntl.flock(held,fcntl.LOCK_UN))
                release.start()
                try:self.module.acquire_lock(waiting.fileno(),timeout=1)
                finally:release.join()
                self.assertEqual(path.stat().st_ino,inode)

    def test_identity_preparation_repairs_only_a_copy_and_keeps_uid_and_history(self):
        tests=Path(__file__).parents[2]/'packages/report-engine/tests'
        with patch.object(sys,'path',[str(tests),*sys.path]):
            from procurement_engine.runtime import run_once
            from test_clean_documents import BusinessGoogle
            from test_runtime import inputs
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);registry,ledger=inputs(root);state=root/'state'
                result=run_once(registry,ledger,state,client=BusinessGoogle())
                self.assertEqual(result['status'],'VERIFIED')
                sid=result['snapshot_id'];rid=result['publication']['release_id']
                with sqlite3.connect(state/'identity.sqlite') as db:
                    db.execute('UPDATE observations SET plan_signature=NULL,entity_signature=NULL WHERE snapshot_id=?',(sid,))
                    count=db.execute('SELECT count(*) FROM observations WHERE snapshot_id=?',(sid,)).fetchone()[0]
                before=(state/'identity.sqlite').read_bytes()
                gaps=[{'snapshot_id':sid,'release_ids':[rid],'observations':count,'missing_plan':count,'missing_entity':count}]
                outcome=self.module.prepare_identity_copy(state,gaps)
                self.assertEqual(outcome['updated_observations'],count)
                self.assertEqual(outcome['updated_fields'],count*2)
                self.assertTrue(outcome['protected_data_unchanged'])
                self.assertEqual((state/'identity.sqlite').read_bytes(),before)
                from procurement_engine.identity_store import IdentityStore
                method=IdentityStore.recover_latest_plan_signatures
                def unauthorized_change(store,*args,**kwargs):
                    changed=method(store,*args,**kwargs)
                    with store.connect() as db:db.execute('UPDATE observations SET uid=? WHERE snapshot_id=?',('wrong-owner',sid))
                    return changed
                with patch.object(IdentityStore,'recover_latest_plan_signatures',unauthorized_change),self.assertRaisesRegex(ValueError,'PROTECTED_DATA_CHANGED'):
                    self.module.prepare_identity_copy(state,gaps)
                self.assertEqual((state/'identity.sqlite').read_bytes(),before)

    def test_wait_for_worker_idle_does_not_stop_worker_or_create_a_lock(self):
        import fcntl
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'run.lock';path.touch();before=path.stat().st_ino
            with path.open('r+') as held:
                fcntl.flock(held,fcntl.LOCK_EX)
                with self.assertRaises(BlockingIOError):self.module.wait_for_worker_idle(path,timeout=0)
                release=threading.Timer(0.05,lambda:fcntl.flock(held,fcntl.LOCK_UN));release.start()
                try:self.module.wait_for_worker_idle(path,timeout=1)
                finally:release.join()
            self.assertEqual(path.stat().st_ino,before)
            path.unlink()
            with self.assertRaises(FileNotFoundError):self.module.wait_for_worker_idle(path,timeout=0)
            self.assertFalse(path.exists())

    def test_prepared_proof_reads_real_scale_without_expanding_other_trust_file_limits(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'prepared.json'
            row={'snapshot_id':'snapshot','locator':'row','signature':'a'*64,'uid':'uid',
                 'plan_signature':'b'*64,'entity_signature':'c'*64,'fillable':['plan_signature','entity_signature']}
            value={'patch':[{**row,'locator':str(i)} for i in range(8126)]}
            path.write_text(json.dumps(value,separators=(',',':')));path.chmod(0o600)
            self.assertGreater(path.stat().st_size,1024*1024)
            native=os.fstat
            def root_file(fd):
                info=native(fd)
                return SimpleNamespace(st_mode=info.st_mode,st_uid=0,st_nlink=info.st_nlink,st_size=info.st_size)
            with patch.object(os,'fstat',root_file):
                with self.assertRaisesRegex(ValueError,'OPERATOR_FILE_UNTRUSTED'):self.module.owned(path)
                self.assertEqual(self.module.load_identity_prepared(path),value)

    def test_identity_patch_is_atomic_idempotent_and_preserves_all_other_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            state=Path(temporary);(state/'run.lock').touch();path=state/'identity.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE observations(snapshot_id TEXT,locator TEXT,signature TEXT,uid TEXT,plan_signature TEXT,entity_signature TEXT,evidence TEXT,PRIMARY KEY(snapshot_id,locator))')
                db.executemany('INSERT INTO observations VALUES(?,?,?,?,?,?,?)',[
                    ('first','a','a'*64,'uid-a',None,None,'frozen-a'),
                    ('second','b','b'*64,None,None,None,'frozen-b'),
                    ('new','c','c'*64,'uid-c','d'*64,'e'*64,'new observation')])
            patch_rows=[{'snapshot_id':sid,'locator':loc,'signature':sig*64,'uid':uid,
                         'plan_signature':'d'*64,'entity_signature':'','fillable':['entity_signature','plan_signature']}
                        for sid,loc,sig,uid in [('first','a','a','uid-a'),('second','b','b',None)]]
            def records():
                with sqlite3.connect(path) as db:return db.execute('SELECT * FROM observations ORDER BY snapshot_id,locator').fetchall()
            before=records();changed=copy.deepcopy(patch_rows);changed[1]['uid']='wrong-owner'
            with self.assertRaisesRegex(ValueError,'IDENTITY_PATCH_CONFLICT'):
                self.module.apply_identity_patch(state,changed)
            self.assertEqual(records(),before,'Conflict in the second snapshot rolls back the first')
            result=self.module.apply_identity_patch(state,patch_rows)
            self.assertEqual(result,{'updated_observations':2,'updated_fields':4,'verified_observations':2})
            after=records()
            self.assertEqual([row[:4]+row[6:] for row in after],[row[:4]+row[6:] for row in before])
            self.assertEqual(after[1],before[1],'Ordinary newer observations are untouched')
            self.assertEqual(self.module.apply_identity_patch(state,patch_rows),
                             {'updated_observations':0,'updated_fields':0,'verified_observations':2})
            sibling=state/'outside.sqlite';path.rename(sibling);path.symlink_to(sibling)
            with self.assertRaisesRegex(ValueError,'IDENTITY_PATH_UNTRUSTED'):
                self.module.apply_identity_patch(state,patch_rows)
            path.unlink();sibling.rename(path)
            with sqlite3.connect(path) as db:db.execute("UPDATE observations SET plan_signature=? WHERE locator='b'",('f'*64,))
            conflict=records()
            with self.assertRaisesRegex(ValueError,'IDENTITY_PATCH_CONFLICT'):
                self.module.apply_identity_patch(state,patch_rows)
            self.assertEqual(records(),conflict)
            import fcntl
            with (state/'run.lock').open('r+') as held:
                fcntl.flock(held,fcntl.LOCK_EX)
                with self.assertRaises(BlockingIOError):self.module.apply_identity_patch(state,patch_rows)

    def test_native_reader_behavior_runs_before_a_source_match_is_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);deploy=root/'deploy';deploy.mkdir()
            (deploy/'plan-weekly-publications.py').write_text(
                'def verify_reader_compatibility(package):\n raise ValueError("reader behavior broken")\n')
            with patch.object(self.module,'owned',side_effect=lambda path,**kw:Path(path).read_bytes()):
                probe=self.module.native_probe(root)
            probe=probe.replace("lease=Path('/app/packages/server/data/reports/publication-readers.lock')",
                                'lease=Path('+repr(str(root/'lease'))+')')
            (root/'lease').touch()
            result=subprocess.run([sys.executable,'-B','-c',probe],capture_output=True,check=False)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(result.stdout,b'','Broken actual reader must not produce a successful hash proof')

    def test_staging_job_only_delivers_and_smokes_public_code(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        match=re.search(r'^  weekly-stage:\n.*?(?=^  [a-z][-a-z]*:|\Z)',workflow,re.MULTILINE|re.DOTALL)
        self.assertIsNotNone(match,'Missing isolated public-code staging job')
        commands=match.group()
        self.assertIn('timeout-minutes: 8',commands)
        self.assertIn('github.actor == github.repository_owner',commands)
        self.assertIn("inputs.mode == 'weekly-stage'",commands)
        for forbidden in ('docker ', 'backup_reference', 'maintenance_lock_acquire', '--operation apply', '--operation finalize'):
            self.assertNotIn(forbidden,commands)
        for required in ('--only-binary=:all:','--no-cache-dir','--no-compile',
                         'MemoryMax=256M','CPUQuota=40%','Nice=19','STAGED_CODE_ONLY_NOT_ADMITTED'):
            self.assertIn(required,commands)
        self.assertNotIn('pulls/79 --jq .head.sha',commands,
                         'Public-tool staging targets installed43 independently of an advancing PR')

    def test_preview_job_is_owner_scoped_and_never_invokes_compaction(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        section=re.search(r'^  weekly-preview:\n.*?(?=^  [a-z][-a-z]*:|\Z)',workflow,re.MULTILINE|re.DOTALL).group()
        for required in ('github.actor == github.repository_owner',"'--check'", "'--expected-revision','live'",
                         'MemoryMax=1G','CPUQuota=40%',"'KillMode=process'","'ExitType=cgroup'"):
            self.assertIn(required,section)
        for forbidden in ('--operation finalize','--operation recover','docker stop','docker restart','docker compose'):
            self.assertNotIn(forbidden,section)

    def test_large_observer_script_does_not_expand_into_an_oversized_github_expression(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        section=re.search(r'^  observe:\n.*?(?=^  [a-z][-a-z]*:|\Z)',workflow,re.MULTILINE|re.DOTALL).group()
        script=textwrap.dedent(section.split('          script: |\n',1)[1])
        self.assertGreater(len(script),21000)
        self.assertNotIn('${{',script,'GitHub implicitly formats this entire scalar; expression limit is21000')
        self.assertIn('envs: WEEKLY_ONLY',section)
        ast.parse(script.split("<<'PY'\n",1)[1].rsplit('\nPY',1)[0])

    def test_staging_push_is_explicit_and_owner_scoped(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        section=workflow.split('  weekly-stage:\n',1)[1].split('  fresh-release:\n',1)[0]
        expression=' '.join(section.split('if: >-\n',1)[1].split('runs-on:',1)[0].split()).replace('&&','and').replace('||','or')
        for actor,branch,message,expected in [('owner','codex/release-observe-20261015','Stage weekly tools for accepted 43f10742',True),
            ('other','codex/release-observe-20261015','Stage weekly tools for accepted 43f10742',False),
            ('owner','main','Stage weekly tools for accepted 43f10742',False),
            ('owner','codex/release-observe-20261015','other',False)]:
            context={'github':SimpleNamespace(event_name='push',actor=actor,repository_owner='owner',ref='refs/heads/'+branch,
                event=SimpleNamespace(head_commit=SimpleNamespace(message=message))),'inputs':SimpleNamespace(mode='',release_sha='')}
            self.assertEqual(bool(eval(expression,{'__builtins__':{}},context)),expected)

    def test_staging_failed_ci_never_reaches_ssh_delivery(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        job=re.search(r'^  weekly-stage:\n.*?(?=^  [a-z][-a-z]*:|\Z)',workflow,re.MULTILINE|re.DOTALL).group()
        program=textwrap.dedent(job.split('        run: |\n',1)[1])
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);binaries=root/'bin';binaries.mkdir()
            for name,body in {'gh':'exit 2','git':'exit 0','ssh-keyscan':'echo synthetic-host',
                              'ssh':'touch "$DELIVERY_SENTINEL"'}.items():
                path=binaries/name;path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o700)
            marker=root/'delivery'
            env={**os.environ,'PATH':str(binaries)+':'+os.environ['PATH'],'RUNNER_TEMP':str(root),
                 'GITHUB_RUN_ID':'123','GITHUB_REPOSITORY':'gaben1488/dash','VPS_USER':'aemr',
                 'VPS_KEY':'synthetic','GH_TOKEN':'synthetic','DELIVERY_SENTINEL':str(marker)}
            result=subprocess.run(['/bin/bash','-s'],input=program,text=True,env=env,capture_output=True,
                                  cwd=Path(__file__).parents[2],timeout=15,check=False)
            self.assertNotEqual(result.returncode,0,'Failed exact source admission must abort staging')
            self.assertFalse(marker.exists(),'Source CI failure reached remote delivery')
            self.assertEqual(result.stdout.strip(),'WEEKLY_PUBLIC_CODE_STAGE_FAILED_SOURCE_CI')

    def test_exact_accepted_runtime_and_cycle_are_admitted(self):
        self.module.validate_context(*self.context(),backup_reference='worker-38831492016/backup')

    def test_changed_source_owner_lease_cycle_ci_or_backup_is_rejected(self):
        for field in ('accepted','source','owner','lease','cycle','restart','ci','backup'):
            with self.subTest(field=field):
                args=list(copy.deepcopy(self.context()));reference='worker-38831492016/backup'
                if field=='accepted':args[0]['release_sha']='0'*40
                if field=='source':args[3]['server']['hashes']['__init__.py']='0'*64
                if field=='owner':args[3]['report-worker']['uid']=0
                if field=='lease':args[3]['server']['lease_regular']=False
                if field=='cycle':args[2]['attempt_ids']=['first','first']
                if field=='restart':args[1]['report-worker']['State']['StartedAt']='restarted'
                if field=='ci':args[5]['head_sha']='0'*40
                if field=='backup':reference='worker-123/backup'
                with self.assertRaises(ValueError):self.module.validate_context(*args,backup_reference=reference)

    def test_non_systemd_or_killing_cgroup_is_rejected(self):
        for properties,cgroup in [({'MainPID':str(os.getpid()),'KillMode':'control-group','ExitType':'cgroup'},'unit'),
                                  ({'MainPID':'1','KillMode':'process','ExitType':'cgroup'},'unit'),
                                  ({'MainPID':str(os.getpid()),'KillMode':'process','ExitType':'cgroup'},'other'),
                                  ({'MainPID':str(os.getpid()),'KillMode':'process','ExitType':'main'},'unit')]:
            with self.subTest(properties=properties,cgroup=cgroup), self.assertRaises(ValueError):
                self.module.validate_lifecycle(properties,cgroup,'unit')
        self.module.validate_lifecycle({'MainPID':str(os.getpid()),'KillMode':'process','ExitType':'cgroup'},'0::/system.slice/unit','unit')

    def test_installed_python_source_is_checked_before_owner_import(self):
        self.assertTrue(hasattr(self.module,'public_hashes'),'Missing pre-import source-tree verifier')
        with tempfile.TemporaryDirectory() as temporary:
            package=Path(temporary)/'procurement_engine';package.mkdir()
            (package/'__init__.py').write_bytes(b'actual exact code')
            with patch.object(self.module,'owned',side_effect=lambda path,**kwargs:Path(path).read_bytes()):
                self.assertEqual(self.module.public_hashes(package),
                                 {'__init__.py':__import__('hashlib').sha256(b'actual exact code').hexdigest()})
                (package/'unsafe').symlink_to(package,target_is_directory=True)
                with self.assertRaises(ValueError):self.module.public_hashes(package)

    def test_root_owned_receipt_may_have_an_operator_owned_home_ancestor(self):
        # VPS trust files are root600 inside root700 beneath /home/aemr.
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'receipt.json';path.write_bytes(b'{}')
            info=SimpleNamespace(st_mode=0o100600,st_uid=0,st_nlink=1,st_size=2)
            with patch.object(self.module.os,'fstat',return_value=info):
                try:body=self.module.owned(path)
                except ValueError:self.fail('Root600 receipt rejected only because home ancestor is operator-owned')
                self.assertEqual(body,b'{}')

    def test_commands_only_call_existing_cli_and_never_stop_or_restore(self):
        commands=self.module.cli_commands(Path('/tree'),Path('/venv/bin/python'),Path('/reader'),
                    Path('/ci.json'),Path('/receipt.json'),Path('/state'),Path('/backup'),
                    operation='apply',revision='b'*64,finalize_review=None)
        rendered=' '.join(commands)
        self.assertIn('/tree/deploy/plan-weekly-publications.py',commands)
        self.assertIn('--source-receipt',commands)
        self.assertNotIn('docker',rendered)
        self.assertNotIn('restore',rendered)
        self.assertNotIn('stop',rendered)
        with self.assertRaises(ValueError):
            self.module.cli_commands(Path('/tree'),Path('/venv/bin/python'),Path('/reader'),
                    Path('/ci.json'),Path('/receipt.json'),Path('/state'),Path('/backup'),
                    operation='finalize',revision='b'*64,finalize_review=None)

    def test_real_pipe_barrier_prevents_work_when_parent_disappears(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary)/'must-not-exist'
            read,write=os.pipe()
            child=subprocess.Popen([sys.executable,'-B','-c',self.module.BARRIER,str(read),
                                    sys.executable,'-B','-c',f'open({str(output)!r},"w").close()'],pass_fds=(read,))
            os.close(read);os.close(write)
            self.assertNotEqual(child.wait(timeout=5),0)
            self.assertFalse(output.exists())

    def test_real_independent_watcher_retains_private_ex_after_supervisor_sigkill(self):
        import fcntl
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            tool=root/'cli.py'
            tool.write_text('''import os,sys,time
from pathlib import Path
def _require_candidate_ci(*args):pass
def require_watchdog_lifecycle():pass
def validate_operator_runtime(*args):pass
def validate_operator_state_owner(*args):pass
def operate(state,**kwargs):
 root=Path(state);assert os.environ.get('OWNER_PREFIX')=='present'
 (root/'applied').write_text(str(os.getpid()));time.sleep(1);return {'status':'SYNTHETIC_ONLY'}
def main(args):
 root=Path(args[args.index('--state')+1]); operation=args[args.index('--operation')+1]
 assert os.environ.get('OWNER_PREFIX')=='present'
 assert operation=='recover'
 (root/'watcher').write_text(str(os.getpid()))
 pid=args[args.index('--watch-owner')+1]; token=args[args.index('--watch-start')+1]
 until=time.monotonic()+5
 while time.monotonic()<until:
  try:
   fields=Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()
   if fields[0]=='Z' or fields[19]!=token:break
  except FileNotFoundError:break
  time.sleep(0.01)
 time.sleep(0.3);(root/'recovered').touch();return 0
if __name__=='__main__':raise SystemExit(main(sys.argv[1:]))
''')
            program='''import fcntl,importlib.util,os,sys
from pathlib import Path
root=Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('operator',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
(root/'ci.json').write_text('{"synthetic":true}');(root/'receipt.json').write_text('{"synthetic":true}')
with (root/'lock').open('w+') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX);os.dup2(lock.fileno(),9,inheritable=True)
 command=[sys.executable,'-B',str(root/'cli.py'),'--state',str(root),'--operation','apply','--candidate','synthetic','--ci-evidence',str(root/'ci.json'),'--source-receipt',str(root/'receipt.json'),'--reader-package','synthetic','--expected-revision','synthetic','--backup','synthetic']
 m.supervise(command,['/usr/bin/env','OWNER_PREFIX=present',sys.executable],owner_prefix=['/usr/bin/env','OWNER_PREFIX=present'],watch_uid=os.geteuid())
'''
            driver=subprocess.Popen([sys.executable,'-B','-c',program,str(root),self.module.__file__],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                until=time.monotonic()+5
                while not (root/'applied').exists() and driver.poll() is None and time.monotonic()<until:time.sleep(0.02)
                self.assertTrue((root/'applied').exists(),driver.communicate(timeout=2) if driver.poll() is not None else 'owner never started')
                self.assertTrue((root/'watcher').exists())
                os.kill(driver.pid,signal.SIGKILL);driver.wait(timeout=3)
                with (root/'lock').open('r+') as lock:
                    with self.assertRaises(BlockingIOError):fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    until=time.monotonic()+5
                    while not (root/'recovered').exists() and time.monotonic()<until:time.sleep(0.02)
                    self.assertTrue((root/'recovered').exists())
                    until=time.monotonic()+2
                    while time.monotonic()<until:
                        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                        except BlockingIOError:time.sleep(0.02)
                    else:self.fail('Private EX did not release after native recovery')
            finally:
                if driver.poll() is None:driver.kill();driver.wait(timeout=3)
                driver.communicate(timeout=3)

    def test_actual_native_api_preserves_guards_journal_and_avoids_second_watchdog(self):
        import runpy

        import procurement_engine.publication_store  # noqa: F401 - dependency smoke before fixture.
        tests=Path(__file__).parents[2]/'packages/report-engine/tests/test_publication_store.py'
        spec=importlib.util.spec_from_file_location('native_publication_fixture',tests)
        fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);tool,store,receipts,options=fixture._operator_fixture(root)
            ci=root/'ci.json';ci.write_text(json.dumps(options['ci']))
            receipt=root/'receipt.json'
            receipt.write_text(json.dumps(tool.candidate_source_receipt(Path(tool.__file__).parents[1],
                options['candidate'],options['ci'],derivation_run_id=42)))
            marker=store.root.parent/'mutable-after-backup';marker.write_text('preserve')
            base=['-c',tool.__file__,'--state',str(store.root.parent),'--candidate',options['candidate'],
                  '--ci-evidence',str(ci),'--source-receipt',str(receipt),'--reader-package',str(options['reader_package']),
                  '--expected-revision',options['expected_revision'],'--backup',str(options['backup'])]
            real_popen=subprocess.Popen
            def forbid_extra_watchdog(command,*args,**kwargs):
                self.assertNotIn('--watch-owner',command,'Thin native API must not launch another watchdog')
                return real_popen(command,*args,**kwargs)
            def operate(operation,review=None):
                argv=base+['--operation',operation]
                if review:argv+=['--finalize-review',review]
                output=io.StringIO()
                with patch.object(runpy,'run_path',return_value=tool.__dict__), patch.object(sys,'argv',argv), \
                     patch.object(subprocess,'Popen',side_effect=forbid_extra_watchdog), contextlib.redirect_stdout(output):
                    try:exec(compile(self.module.OWNER,'<actual-native-api-adapter>','exec'),{})  # noqa: S102 - execute the reviewed fixed bootstrap.
                    except SystemExit:
                        if operation=='apply':self.fail('Native apply must retain guards without creating a second watchdog')
                        raise
                return json.loads(output.getvalue())
            self.assertEqual(operate('apply')['status'],'COMPACTED')
            self.assertTrue((store.root/'.retirement/original').is_dir())
            self.assertEqual(operate('recover')['status'],'COMMITTED')
            with self.assertRaises(SystemExit):operate('finalize','wrong')
            self.assertTrue((store.root/'.retirement/original').is_dir())
            # Real retained-download readback before this synthetic finalize.
            for receipt in receipts:
                self.assertTrue(store.read_artifact(receipt['release_id'],'main_report.docx').startswith(b'PK'))
            review=options['candidate']+':'+options['expected_revision']
            self.assertEqual(operate('finalize',review)['status'],'FINALIZED')
            self.assertFalse((store.root/'.retirement').exists())
            self.assertEqual(marker.read_text(),'preserve')


if __name__=='__main__':unittest.main()
