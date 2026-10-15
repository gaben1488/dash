"""Exercise cache-only maintenance with synthetic Docker state, never a VPS."""
import ast
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "cleanup-build-cache.sh"


class EarlyScratchCapacityTests(unittest.TestCase):
    def test_observed_archive_headroom_is_required_before_api_freeze(self):
        import contextlib
        import io
        from types import SimpleNamespace
        from unittest.mock import patch
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        program = textwrap.dedent(workflow.split("<<'PYRUNNERCAPACITY'\n",1)[1].split('\n          PYRUNNERCAPACITY',1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary);(root/'release').mkdir()
            budget = {'source_bytes':36*1024**3,'vps_backup_free_bytes':5900*1024**2,
                      'vps_backup_required_bytes':6900*1024**2}
            (root/'release/capacity-input.json').write_text(json.dumps(budget))
            with patch.dict(os.environ,{'RUNNER_TEMP':temporary}), \
                 patch('shutil.disk_usage',return_value=SimpleNamespace(free=100*1024**3)), \
                 contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(SystemExit,'BACKUP_SPACE_BUDGET_INSUFFICIENT'):
                exec(compile(program,'<observed-archive-budget>','exec'),{})  # noqa: S102 - reviewed actual workflow

    def test_archive_forecast_authenticates_prior_manifest_and_rejects_invalid_sizes(self):
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        program = textwrap.dedent(workflow.split("<<'PYVPSCAPACITY' >",1)[1].split('\n',1)[1].split('\n          PYVPSCAPACITY',1)[0])
        tree = ast.parse(program)
        definition = next((node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='archive_budget'),None)
        self.assertIsNotNone(definition,'Missing authenticated observed archive forecast')
        scope={'json':json,'hashlib':hashlib}
        exec(compile(ast.Module(body=[definition],type_ignores=[]),'<archive-forecast>','exec'),scope)  # noqa: S102 - actual workflow
        body=json.dumps({'format':2,'archive_bytes':5*1024**3,'bytes':30*1024**3}).encode()
        checksum=hashlib.sha256(body).hexdigest()
        required=scope['archive_budget'](body,checksum,31*1024**3)
        self.assertGreaterEqual(required,7*1024**3)
        for invalid,sha in ((body,'0'*64),(b'{}',checksum),
                            (json.dumps({'format':2,'archive_bytes':True,'bytes':1}).encode(),None)):
            with self.subTest(invalid=invalid),self.assertRaises((ValueError,SystemExit)):
                scope['archive_budget'](invalid,sha or hashlib.sha256(invalid).hexdigest(),31*1024**3)

    def test_interpolated_ssh_scripts_fit_github_expression_limit(self):
        import re
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        for match in re.finditer(r'^          script: \|\n((?:^            .*\n|^\n)*)',workflow,re.MULTILINE):
            script = textwrap.dedent(match[1])
            if '${{' not in script:continue
            # GitHub converts mixed strings to format(), escaping quotes/braces.
            bound = len(script.encode('utf-16-le'))//2 + sum(script.count(c) for c in "'{}") + 100
            self.assertLess(bound,21000,'Split oversized SSH diagnostics before GitHub rejects the entire workflow')

    def test_capacity_counts_each_hardlink_path_that_restore_will_materialize(self):
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        program = textwrap.dedent(workflow.split("<<'PYVPSCAPACITY' >", 1)[1].split('\n', 1)[1]
                                 .split('\n          PYVPSCAPACITY', 1)[0])
        arguments = next(node for node in ast.walk(ast.parse(program))
                         if isinstance(node, ast.List) and node.elts and isinstance(node.elts[0], ast.Constant)
                         and node.elts[0].value == 'du')
        flags = [ast.literal_eval(item) for item in arguments.elts[:-1]]
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary);first = source/'first';first.write_bytes(b'x'*32768)
            (source/'second').hardlink_to(first)
            total = int(subprocess.check_output([*flags,str(source)],text=True).split()[0])
            self.assertGreaterEqual(total,65536)

    def test_full_restore_capacity_is_admitted_before_freezing_writers(self):
        import contextlib
        import io
        from types import SimpleNamespace
        from unittest.mock import patch
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        self.assertIn("<<'PYRUNNERCAPACITY'", workflow,
                      'Runner full-restore capacity must be checked while API remains online')
        self.assertLess(workflow.index("<<'PYRUNNERCAPACITY'"),
                        workflow.index('      - name: Freeze writers once'))
        program = textwrap.dedent(workflow.split("<<'PYRUNNERCAPACITY'\n", 1)[1]
                                 .split('\n          PYRUNNERCAPACITY', 1)[0])
        gib = 1024**3
        for free, source in ((50*gib, 31*gib), (35*gib, 31*gib), (50*gib, -1), (50*gib, True)):
            with self.subTest(free=free, source=source), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary);(root/'release').mkdir()
                (root/'release/capacity-input.json').write_text(json.dumps({
                    'source_bytes':source,'vps_backup_free_bytes':8*gib,'vps_backup_required_bytes':6*gib}))
                with patch.dict(os.environ, {'RUNNER_TEMP':temporary}), \
                     patch('shutil.disk_usage', return_value=SimpleNamespace(free=free)), \
                     contextlib.redirect_stdout(io.StringIO()) as output:
                    if free == 50*gib and type(source) is int and source >= 0:
                        exec(compile(program,'<runner-capacity>','exec'),{})  # noqa: S102 - reviewed workflow fixture
                        self.assertIn('RELEASE_INDEPENDENT_CAPACITY_ADMITTED',output.getvalue())
                    else:
                        with self.assertRaises(SystemExit):exec(compile(program,'<runner-capacity>','exec'),{})  # noqa: S102 - reviewed workflow fixture


class HostReserveTests(unittest.TestCase):
    def exercise(self, scenario):
        import contextlib
        import io
        from unittest.mock import patch
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        self.assertTrue("<<'PYRESERVE'" in workflow, 'Missing bounded host reserve maintenance')
        program = textwrap.dedent(workflow.split("<<'PYRESERVE'\n", 1)[1].split('\n            PYRESERVE', 1)[0])
        changed = []
        def command(args, **kwargs):
            if args[0] == 'findmnt':
                return json.dumps({'filesystems': [{'source': '/dev/other' if scenario == 'device' else '/dev/vda2',
                    'fstype': 'xfs' if scenario == 'filesystem' else 'ext4'}]})
            if args[:2] == ['docker', 'inspect']:
                return json.dumps([{'Id': str(i), 'Image': 'verified', 'RestartCount': 0, 'Mounts': [],
                    'Config': {}, 'State': {'Status': 'exited' if i == 3 else 'running', 'StartedAt': 'fixed'}} for i in range(4)])
            if args[:2] == ['tune2fs', '-l']:
                reserved = 100 if changed or scenario == 'already' else 2000 if scenario == 'ratio' else 500
                return f'Block count: 10000\nReserved block count: {reserved}\nBlock size: 4096\n'
            if args[:2] == ['tune2fs', '-r']:
                changed.append(args);return ''
            raise AssertionError(args)
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / 'lock';lock.touch()
            program = program.replace('/run/lock/aemr-maintenance.lock', str(lock))
            with patch('subprocess.check_output', side_effect=command), patch('os.geteuid', return_value=0), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                if scenario in ('filesystem', 'device', 'ratio'):
                    with self.assertRaises(SystemExit):exec(compile(program, '<reserve-fixture>', 'exec'), {})  # noqa: S102 - reviewed local workflow fixture
                else:
                    exec(compile(program, '<reserve-fixture>', 'exec'), {})  # noqa: S102 - reviewed local workflow fixture
                    self.assertIn('HOST_RESERVE_', output.getvalue())
        self.assertEqual(changed, [['tune2fs', '-r', '100', '/dev/vda2']] if scenario == 'valid' else [])

    def test_only_verified_default_ext4_reserve_is_reduced_to_one_percent(self):
        for scenario in ('valid', 'already'):
            with self.subTest(scenario=scenario):self.exercise(scenario)

    def test_unknown_filesystem_device_or_reservation_is_not_changed(self):
        for scenario in ('filesystem', 'device', 'ratio'):
            with self.subTest(scenario=scenario):self.exercise(scenario)


class ReleaseFailureEvidenceTests(unittest.TestCase):
    def programs(self):
        import re
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        self.assertTrue('      - name: Preserve bounded private release failure evidence\n' in workflow)
        step = workflow.split('      - name: Preserve bounded private release failure evidence\n', 1)[1]
        programs = re.findall(r"python3 - <<'PY'[^\n]*\n(.*?)\n          PY", step, re.DOTALL)
        self.assertEqual(len(programs), 2, 'Private failure evidence must survive runner cleanup')
        cleanup = step.split('      - name: Remove private runner state and credentials\n', 1)[1]
        self.assertIn('if: always()', cleanup)
        return [textwrap.dedent(program) for program in reversed(programs)]

    def test_only_known_failure_codes_are_public_and_private_credentials_are_not_copied(self):
        import contextlib
        import io
        from unittest.mock import patch
        private, public = self.programs()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'release';root.mkdir()
            (root / 'stage.log').write_text('RELEASE_SAVED_RUNTIME_MISMATCH\nRELEASE_CONTROLLER_FAILED\nPRIVATE_BEARER_VALUE\nRELEASE_UNKNOWN_PRIVATE_VALUE\nSOURCE_CHANGED_DURING_BACKUP\n')
            (root / 'prepare.log').write_text('{"error":"BACKUP_STORAGE_INSUFFICIENT","private":"PRIVATE_VALUE"}\n')
            (root / 'key').write_text('PRIVATE_SSH_VALUE')
            (root / '.env.production').write_text('PRIVATE_ENV_VALUE')
            with patch.dict(os.environ, {'RUNNER_TEMP': temporary}), contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(private, '<private-evidence-fixture>', 'exec'), {})  # noqa: S102 - trusted local workflow
            value = json.loads(output.getvalue())
            self.assertEqual(set(value), {'stage.log','prepare.log'})
            self.assertIn('PRIVATE_BEARER_VALUE', value['stage.log'])  # Preserved only in root-private transport.
            with patch.dict(os.environ, {'RUNNER_TEMP': temporary}), contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(public, '<public-evidence-fixture>', 'exec'), {})  # noqa: S102 - trusted local workflow
            self.assertEqual(output.getvalue(), 'PRIVATE_RELEASE_FAILURE_CODE=BACKUP_STORAGE_INSUFFICIENT\nPRIVATE_RELEASE_FAILURE_CODE=RELEASE_CONTROLLER_FAILED\nPRIVATE_RELEASE_FAILURE_CODE=RELEASE_SAVED_RUNTIME_MISMATCH\nPRIVATE_RELEASE_FAILURE_CODE=SOURCE_CHANGED_DURING_BACKUP\n')

    def test_small_failure_phase_survives_a_full_private_log_budget(self):
        import contextlib
        import io
        from unittest.mock import patch
        private, _ = self.programs()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'release';root.mkdir()
            for index in range(40):(root / f'{index:02}.log').write_text('x' * 200000)
            phase = {'state':'FROZEN_TRIAL_REPLAY_FAILED','phase':'verify_restored_documents_and_sqlite'}
            (root / 'trial-phase.log').write_text(json.dumps(phase))
            with patch.dict(os.environ, {'RUNNER_TEMP':temporary}), contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(private,'<phase-preservation-fixture>','exec'),{})  # noqa: S102 - reviewed workflow fixture
            captured = json.loads(output.getvalue())
            self.assertIn('trial-phase.log',set(captured),'Full phase attribution was displaced by unrelated private logs')
            self.assertEqual(json.loads(captured['trial-phase.log']),phase)
            self.assertEqual(len(captured),32)

    def test_private_log_capture_is_bounded(self):
        import contextlib
        import io
        from unittest.mock import patch
        private, _ = self.programs()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'release';root.mkdir()
            for index in range(40):(root / f'{index:02}.log').write_text('x' * 200000)
            with patch.dict(os.environ, {'RUNNER_TEMP': temporary}), contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(private, '<bounded-evidence-fixture>', 'exec'), {})  # noqa: S102 - trusted local workflow
            value = json.loads(output.getvalue())
            self.assertEqual(len(value), 32)
            self.assertTrue(all(len(body) == 131072 for body in value.values()))


class UnacceptedCheckpointRetirementTests(unittest.TestCase):
    def exercise(self, scenario, workflow=None, run=38716276232):
        import contextlib
        import io
        from types import SimpleNamespace
        from unittest.mock import patch
        workflow = workflow or (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        fragment=workflow.split('  superseded-backup-archives:',1)[1].split('  release-configuration-permissions:',1)[0]
        marker='PYBACKUPRETIRE' if "<<'PYBACKUPRETIRE'" in fragment else 'PY'
        program=textwrap.dedent(fragment.split("<<'"+marker+"'\n",1)[1].split('\n            '+marker,1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);base=root/'backups';retained=base/'worker-38349415596/backup';retained.mkdir(parents=True)
            old=retained/'state.tar.gz'
            with old.open('wb') as stream:stream.truncate(4589649313)
            (retained/'manifest.json').write_text(json.dumps({'format':2,'archive_bytes':4589649313,'archive_sha256':'f'*64}))
            failed=base/('worker-'+str(run));(failed/'backup').mkdir(parents=True)
            candidate=failed/'backup/state.tar.gz';candidate.write_bytes(b'synthetic unaccepted checkpoint')
            details={'format':2,'archive_bytes':candidate.stat().st_size,'archive_sha256':'bad' if scenario=='wrong-hash' else 'f'*64,
                     'files':{name:{} for name in ('aemr.db','reports/inputs/registry.json','reports/inputs/ledger.json')}}
            manifest=failed/'backup/manifest.json';manifest.write_text(json.dumps(details))
            (failed/'prepared').touch();(root/'lock').touch();(root/'state/release-runtime').mkdir(parents=True)
            sha={38716276232:'eba8f147a1098a7d14dfaefc442055fbcdfa93f2',38722058204:'f864d5309e5df761c2974d700165063ed693e521',
                 38727198402:'b8e98ec5b255bf32d1aafb68a7e5d1e018db3e7b'}[run]
            runtime={'candidate':sha,'volume':'aemr_server_data',
                     'image':'sha256:a2b6a1b9a4726e620f77405468f877a20ba1de07c69b8ede4e16a52b46198bac','server':'server','worker':'worker'}
            (failed/'runtime.json').write_text(json.dumps(runtime))
            if scenario=='pending':(root/'state/pending-release.json').touch()
            if scenario=='accepted':(root/'state/release-accepted.json').write_text(json.dumps({'acceptance':{'manifest_sha256':__import__('hashlib').sha256(manifest.read_bytes()).hexdigest()}}))
            if scenario=='adopted':(root/'state/release-runtime/trial-plan.json').write_text(json.dumps({'backup_reference':'worker-'+str(run)+'/backup'}))
            if run==38727198402:
                plan={'backup_reference':'worker-'+str(run)+'/backup','release_sha':sha,
                      'manifest_sha256':__import__('hashlib').sha256(manifest.read_bytes()).hexdigest()}
                if scenario=='wrong-plan':plan['release_sha']='0'*40
                (root/'state/release-runtime/trial-plan.json').write_text(json.dumps(plan))
                request={'candidate':sha,'run_id':str(run),'stage':'prepare',
                         'plan_sha256':__import__('hashlib').sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
                if scenario=='wrong-request':request['plan_sha256']='0'*64
                (failed/'plan-prepared.json').write_text(json.dumps(request))
            records=[{'Id':name,'Image':'kept','Config':{},'HostConfig':{},'RestartCount':0,'Mounts':[],
                      'State':{'Status':'running' if name!='worker' else 'exited','Health':{'Status':'healthy'},'StartedAt':'kept','OOMKilled':False}}
                     for name in ('server','web','caddy','worker')]
            program=program.replace('/run/lock/aemr-maintenance.lock',str(root/'lock')).replace('/var/lib/aemr',str(root/'state')).replace('/home/aemr/.dash-private-backups',str(base))
            with patch('hashlib.file_digest',return_value=SimpleNamespace(hexdigest=lambda:'f'*64)), \
                 patch('subprocess.check_output',return_value=json.dumps(records).encode()),contextlib.redirect_stdout(io.StringIO()):
                if scenario=='valid':exec(compile(program,'<unaccepted-checkpoint>','exec'),{})  # noqa: S102 - reviewed workflow fixture
                else:
                    with self.assertRaises(AssertionError):exec(compile(program,'<unaccepted-checkpoint>','exec'),{})  # noqa: S102 - reviewed workflow fixture
            self.assertEqual(candidate.exists(),scenario!='valid')
            self.assertTrue(old.exists());self.assertTrue(manifest.exists())

    def test_only_unaccepted_unreferenced_checkpoint_blob_is_retired(self):
        for run in (38716276232,38722058204):
            for scenario in ('valid','wrong-hash','pending','adopted','accepted'):
                with self.subTest(run=run,scenario=scenario):self.exercise(scenario,run=run)

    def test_obsolete_failed_frozen_capture_retains_keeper_and_all_metadata(self):
        for scenario in ('valid','wrong-hash','pending','accepted','wrong-plan','wrong-request'):
            with self.subTest(scenario=scenario):self.exercise(scenario,run=38727198402)


class FailedCandidateImagesTests(unittest.TestCase):
    def exercise(self, scenario):
        import contextlib
        import io
        from types import SimpleNamespace
        from unittest.mock import patch
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        self.assertTrue("<<'PYFAILEDIMAGES'" in workflow, 'Missing exact failed-candidate image retirement')
        program = textwrap.dedent(workflow.split("<<'PYFAILEDIMAGES'\n", 1)[1].split('\n            PYFAILEDIMAGES', 1)[0])
        images = {};removed = []
        for revision, pairs in {
            '30cfd6914a60eddfde3f85fcc9528307b484ef92': [('server','e711a93ad863d192329ca3d2cb1434f95bcdb54045e2372941782a6c3b14b284'),('web','15f96a15c16caa947772ff5102a413a535cf7a32fc9ec578dec8a20d27c0573a')],
            '2d865fe1d3f86c741392b7bbc9cd91e991aeb286': [('server','7899df2a49e2f6bd42a29748789548ad1685525cfc93b9aaba616a70f3f733b4'),('web','6bf15fa3a6943effbe7136690caf1b4a31bc44486be90c96cb022dfb43d44295')],
            'b28ad02083c016d8fb920f8091d1490fcb6f0843': [('server','6240e45f92a653fc3fe3de17b20698b658de251c9dafd90253e50dd4349dc3d4'),('web','d847a369e76d31e22df13485c44742134588f074137bf795b70544a82e56c62b')],
            '211fac62b9ce1b2fb9a3628c1b04e998db5256b0': [('server','2a850d198c080b4fa17ea6f192f4a4ce9d79fc7aefa2c4a90bdc69874510d071'),('web','071ba3bb71b03c27f16ee8f69ce2bb2b785b15967ac4b6c4e8d89c65cab848e5')],
            'eba8f147a1098a7d14dfaefc442055fbcdfa93f2': [('server','733a007deba806f72741b09b9fc52de12f2a8b32124c9abb49b18c2408830c18'),('web','236d06af1ff152910ed146cc3762b0d7c08b382f99adf6b7d2ee454305a1676e')],
            'f864d5309e5df761c2974d700165063ed693e521': [('server','336cd9b583eb8d4dd0d0967563643e62816701a93c949315bcb15a8286189e54'),('web','c0b78a11a7ca7e1ba573257dd2747306ff45cc2bc11ea159cdd9100ebc89e412')],
            'b8e98ec5b255bf32d1aafb68a7e5d1e018db3e7b':[('server','a1df67e07481a7fca228261b9553bb25a74c82410a27921c2175fcb1ffc58d56'),('web','7f4507b81634ea968f66805a518f378e27d8aaadfdcd1a0f85e0dbe2c4f4ac10')],
            'fe1979b5b5f8c8de2443c09a3cb952b7e1563513':[('server','e120405deaeb00066fc00f22cbd46b5b93840a9d0e5c78e8a2123b74010d3bd9'),('web','9290cbfe1e201b9c6cc7dd62eda2b3dbc9109bfe84729725e40ffd763646911a')],
        }.items():
            for role, identity in pairs:
                tag='aemr-'+role+':release-'+revision
                images[tag]={'Id':'sha256:'+identity,'RepoTags':[tag],'Config':{'Labels':{'org.opencontainers.image.revision':revision}}}
        newest=images['aemr-server:release-fe1979b5b5f8c8de2443c09a3cb952b7e1563513']
        if scenario=='latest-other-tag':newest['RepoTags'].append('aemr-server:previous')
        if scenario=='retagged':next(iter(images.values()))['Id']='sha256:'+'f'*64
        if scenario=='other-tag':next(iter(images.values()))['RepoTags'].append('aemr-server:previous')
        if scenario=='foreign-source':next(iter(images.values()))['Config']['Labels']['org.opencontainers.image.revision']='f'*40
        protected=[{'Id':'container','Name':'/aemr-server-1',
            'Image':newest['Id'] if scenario=='latest-in-use' else next(iter(images.values()))['Id'] if scenario=='in-use' else 'sha256:protected',
            'Mounts':[{'Destination':'/a'},{'Destination':'/b'}],
            'State':{'Status':'running','StartedAt':'stable','Health':{'Status':'healthy','Log':[]}}}]
        def command(args, **kwargs):
            if args[1:3]==['ps','--all']:return 'container\n'
            if args[1]=='inspect':
                values=json.loads(json.dumps(protected))
                if removed and scenario=='mount-order':values[0]['Mounts'].reverse()
                if removed and scenario=='health-history':values[0]['State']['Health']['Log'].append({'ExitCode':0})
                return json.dumps(values)
            if args[1:3]==['image','ls']:
                return '\n'.join(json.dumps({'Repository':tag.split(':')[0],'Tag':tag.split(':',1)[1],'ID':image['Id']}) for tag,image in images.items())
            if args[1:3]==['image','inspect']:return json.dumps([images[args[3]]])
            if args[1:3]==['image','rm']:
                self.assertNotIn('--force',args)
                identity=args[3];removed.append(identity)
                for tag in [tag for tag,image in images.items() if image['Id']==identity]:images.pop(tag)
                return ''
            raise AssertionError(args)
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'lock').touch()
            program=program.replace('/run/lock/aemr-maintenance.lock',str(root/'lock')).replace('/var/lib/aemr',str(root/'state')).replace('/home/aemr/.dash-private-backups',str(root/'backups'))
            with patch('os.geteuid',return_value=0),patch('subprocess.check_output',side_effect=command), \
                 patch('shutil.disk_usage',return_value=SimpleNamespace(free=123)),contextlib.redirect_stdout(io.StringIO()) as output:
                if scenario in ('valid','mount-order','health-history'):
                    exec(compile(program,'<failed-images>','exec'),{})  # noqa: S102 - trusted workflow fixture
                    self.assertIn('FAILED_CANDIDATE_IMAGES_REMOVED',output.getvalue())
                else:
                    with self.assertRaisesRegex(SystemExit,'FAILED_IMAGE_CLEANUP_REJECTED_IMAGE_VALIDATION'):exec(compile(program,'<failed-images>','exec'),{})  # noqa: S102 - trusted workflow fixture
        self.assertEqual(len(removed),16 if scenario in ('valid','mount-order','health-history') else 0)

    def test_only_exact_unreferenced_failed_images_are_retired(self):
        for scenario in ('valid','mount-order','health-history'):
            with self.subTest(scenario=scenario):self.exercise(scenario)

    def test_live_rollback_retagged_and_foreign_images_are_protected(self):
        for scenario in ('in-use','retagged','other-tag','foreign-source','latest-in-use','latest-other-tag'):
            with self.subTest(scenario=scenario):self.exercise(scenario)


class CacheCleanupTests(unittest.TestCase):
    def run_cleanup(self, scenario="normal"):
        self.assertTrue(SCRIPT.is_file(), "Missing cache-only maintenance implementation")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            trace = root / "trace.jsonl"
            docker = root / "docker"
            docker.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
trace = Path(os.environ['CACHE_TEST_TRACE'])
previous = trace.read_text() if trace.exists() else ''
with trace.open('a') as stream:
    stream.write(json.dumps(args) + '\\n')
scenario = os.environ['CACHE_TEST_SCENARIO']
if args[:2] == ['ps', '--all']:
    print('synthetic-container')
    if scenario == 'oneoff' and 'label=com.docker.compose.oneoff=False' not in args:
        print('transient-container')
elif args[0] == 'inspect':
    if args[-1] == 'transient-container' and 'prune' in previous:
        sys.exit(2)
    if scenario == 'unreadable':
        sys.exit(2)
    changed = scenario == 'changed' and 'prune' in previous
    mounts = [{'Destination': '/a', 'Source': '/private/a'}, {'Destination': '/b', 'Source': '/private/b'}]
    if scenario == 'mount-order' and 'prune' in previous:
        mounts.reverse()
    if scenario == 'mount-changed' and 'prune' in previous:
        mounts[0]['Source'] = '/private/replaced'
    print(('different' if changed else 'synthetic') + '|image|running|' + json.dumps(mounts))
elif args[:2] == ['image', 'ls']:
    print('sha256:synthetic rollback:previous')
elif args[:2] == ['builder', 'prune']:
    if scenario == 'prune-failed':
        sys.exit(2)
    print('Total reclaimed space: 5GB')
elif args[:2] == ['system', 'df']:
    print('Build Cache: synthetic')
else:
    sys.exit(3)
""")
            docker.chmod(0o700)
            result = subprocess.run(['bash', str(SCRIPT)], capture_output=True,
                                    text=True, timeout=10, check=False,
                                    env={**os.environ, "PATH": tmp + os.pathsep + os.environ['PATH'],
                                         "CACHE_TEST_TRACE": str(trace),
                                         "CACHE_TEST_SCENARIO": scenario})
            calls = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
            return result, calls

    def test_only_regenerable_build_cache_is_removed_and_protected_state_is_rechecked(self):
        result, calls = self.run_cleanup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)
        self.assertEqual([call for call in calls if 'prune' in call],
                         [['builder', 'prune', '--all', '--force']])
        self.assertGreaterEqual(sum(call[0] == 'inspect' for call in calls), 2)
        self.assertFalse(any(call[0] in {'rm', 'rmi', 'stop', 'start', 'restart', 'volume'}
                             for call in calls))

    def test_mount_serialization_order_does_not_trigger_false_state_change(self):
        result, _ = self.run_cleanup('mount-order')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_mount_change_still_blocks_success(self):
        result, _ = self.run_cleanup('mount-changed')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)

    def test_unreadable_protected_state_refuses_cleanup(self):
        result, calls = self.run_cleanup('unreadable')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('prune' in call for call in calls))

    def test_changed_protected_state_cannot_be_reported_as_success(self):
        result, _ = self.run_cleanup('changed')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)

    def test_failed_prune_cannot_be_reported_as_success(self):
        result, _ = self.run_cleanup('prune-failed')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)

    def test_disappearing_oneoff_rehearsal_does_not_hide_stable_service_readback(self):
        result, _ = self.run_cleanup('oneoff')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)


class SupersededBackupTests(unittest.TestCase):
    def exercise(self, scenario):
        workflow = SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml'
        program = textwrap.dedent(workflow.read_text().split("<<'PYBACKUPRETIRE'\n", 1)[1]
                                  .split('\n            PYBACKUPRETIRE', 1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = root / 'backups'
            retained = base / 'worker-38349415596/backup'
            retained.mkdir(parents=True)
            content = b'accepted complete archive'
            (retained / 'state.tar.gz').write_bytes(content)
            (retained / 'manifest.json').write_text(json.dumps({'format': 2,
                'archive_bytes': len(content), 'archive_sha256': hashlib.sha256(content).hexdigest()}))
            originals = []
            for run in ('worker-38171945386', 'worker-38178244703'):
                folder = base / run / 'backup'
                folder.mkdir(parents=True)
                target = folder / 'state.tar.gz'
                target.write_bytes(b'old redundant archive')
                (folder / 'manifest.json').write_bytes(b'keep audit receipt')
                originals.append(target)
            (root / 'runtime').mkdir()
            (root / 'lock').touch()
            if scenario == 'corrupt-retained':
                (retained / 'state.tar.gz').write_bytes(b'x' * len(content))
            elif scenario == 'pending':
                (root / 'runtime/pending-release.json').touch()
            elif scenario == 'quiescent':
                (base / 'worker-38171945386/quiescent').touch()
            elif scenario in ('symlink-second', 'dangling-second'):
                originals[1].unlink()
                originals[1].symlink_to(retained / 'state.tar.gz' if scenario == 'symlink-second' else root / 'missing')
            elif scenario == 'dangling-parent-second':
                folder = originals[1].parent
                saved = folder.with_name('saved-receipt')
                folder.rename(saved)
                folder.symlink_to(root / 'missing-directory', target_is_directory=True)
                originals[1] = saved / 'state.tar.gz'
            program = (program.replace('/home/aemr/.dash-private-backups', str(base))
                       .replace('/var/lib/aemr', str(root / 'runtime'))
                       .replace('/run/lock/aemr-maintenance.lock', str(root / 'lock'))
                       .replace('4589649313', str(len(content)))
                       .replace('2_000_000_000', '0').replace('3_000_000_000', '1000'))
            result = subprocess.run([sys.executable, '-I', '-'], input=program, text=True,
                                    capture_output=True, timeout=10, check=False)
            if scenario == 'valid':
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)['removed'], 2)
                self.assertTrue(all(not p.exists() for p in originals))
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('AssertionError', result.stderr)
                self.assertTrue(all(p.exists() or p.is_symlink() for p in originals))
            self.assertTrue((retained / 'state.tar.gz').exists())
            self.assertTrue(all(p.with_name('manifest.json').read_bytes() == b'keep audit receipt'
                                for p in originals))

    def test_exact_old_blobs_only_and_retained_archive_and_receipts_survive(self):
        self.exercise('valid')

    def test_refuse_before_any_delete_when_retained_proof_or_custody_is_invalid(self):
        for scenario in ('corrupt-retained', 'pending', 'quiescent', 'symlink-second', 'dangling-second', 'dangling-parent-second'):
            with self.subTest(scenario=scenario):
                self.exercise(scenario)


class WeeklyTransientMaintenanceTests(unittest.TestCase):
    def program(self):
        root = SCRIPT.parents[1]
        workflow = (root / '.github/workflows/vps-cache-cleanup.yml').read_text()
        block = workflow[workflow.index('  attempt-payloads:'):workflow.index('  cache-only:')]
        host = textwrap.dedent(block.split("<<'PYMAINT'\n", 1)[1].rsplit('\n            PYMAINT', 1)[0])
        return next(ast.literal_eval(node.value) for node in ast.walk(ast.parse(host))
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'program'
                                                           for t in node.targets))

    def test_actual_data_process_holds_ex_on_readonly_open_lock_until_exit(self):
        import fcntl
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / 'maintenance.lock'
            lock.touch()
            prefix = self.program().split("for module in", 1)[0].replace('/maintenance.lock', str(lock))
            child = subprocess.Popen([sys.executable, '-I', '-c', prefix + "print('READY',flush=True);sys.stdin.read()"],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), 'READY')
                with lock.open('r+') as competing:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    child.stdin.close()
                    self.assertEqual(child.wait(timeout=3), 0)
                    fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=3)
                child.stdout.close();child.stderr.close()

    def test_cold_isolated_bootstrap_preserves_weekly_and_current_before_compaction(self):
        root = SCRIPT.parents[1]
        sys.path.insert(0, str(root / 'packages/report-engine/tests'))
        from test_weekly_archive import complete_attempt
        program = self.program()
        with tempfile.TemporaryDirectory() as temporary:
            state, _ = complete_attempt(Path(temporary))
            (state / 'run.lock').touch()
            maintenance_lock = Path(temporary) / 'maintenance.lock'
            maintenance_lock.touch()
            original = state / 'attempts/attempt-1/status.json'
            frozen_status = original.read_bytes()
            for index in range(4):
                folder = state / 'attempts' / f'non-weekly-{index}'
                (folder / 'bundle').mkdir(parents=True)
                (folder / 'bundle/payload').write_bytes(b'synthetic duplicate payload')
                (folder / 'status.json').write_text(json.dumps({'attempt_id': folder.name,
                    'report_date': '29.09.2034', 'finished_at': f'2034-09-29T00:00:0{index}Z'}))
            (state / 'status.json').write_text('{"attempt_id":"non-weekly-3"}')
            program = (program.replace('/memory-patch/', str(root / 'packages/report-engine/src/procurement_engine') + '/')
                       .replace('/app/packages/server/data/reports', str(state))
                       .replace('/maintenance.lock', str(maintenance_lock)))
            result = subprocess.run([sys.executable, '-B', '-c', program], capture_output=True,
                                    text=True, timeout=30, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((state / 'archives/WEEKLY-2034-09-28').is_dir())
            self.assertEqual(original.read_bytes(), frozen_status)
            self.assertFalse((state / 'attempts/non-weekly-0/bundle').exists())
            self.assertTrue((state / 'attempts/non-weekly-2/bundle').is_dir())
            self.assertTrue((state / 'attempts/non-weekly-3/bundle').is_dir())
            self.assertEqual(json.loads(result.stdout.splitlines()[0]), {'weekly_recovery_status_counts': {'SEALED': 1}})


if __name__ == '__main__':
    unittest.main()
