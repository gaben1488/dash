"""Retire only explicitly sampled, untagged, unreferenced image IDs."""
import copy
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ImageRetentionTests(unittest.TestCase):
    def setUp(self):
        path=Path(__file__).with_name('unused_image_retention.py')
        self.assertTrue(path.is_file())
        spec=importlib.util.spec_from_file_location('image_retention',path)
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.ids=['sha256:'+letter*64 for letter in 'abcd']
        self.images=[{'Id':value,'RepoTags':None,'RepoDigests':None} for value in self.ids]

    def test_capacity_targets_require_exact_source_and_sole_tag(self):
        identity, source = next(iter(self.module.CAPACITY_TARGETS.items()))
        image = {'Id': identity, 'RepoTags': ['aemr-server:release-' + source], 'RepoDigests': [],
                 'Config': {'Labels': {'org.opencontainers.image.revision': source}}}
        select = self.module.select_capacity_images
        self.assertEqual(select([image], [], set()), [identity])
        self.assertEqual(select([image], [{'Image': identity}], set()), [])
        self.assertEqual(select([image], [], {identity}), [])
        for change in ({'RepoTags': []}, {'RepoTags': image['RepoTags'] + ['OTHER']},
                       {'RepoDigests': ['sha256:' + 'a'*64]}, {'Config': {'Labels': {}}},
                       {'Id': self.ids[0]}):
            with self.subTest(change=change):
                self.assertEqual(select([{**image, **change}], [], set()), [])

    def test_capacity_retains_every_capsule_that_still_has_a_state_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            capsule = Path(temporary)
            backup = capsule/'backup'; backup.mkdir()
            self.assertFalse(self.module.capsule_has_state_archive(capsule))
            archive = backup/'state.tar.gz'; archive.write_bytes(b'backup')
            self.assertTrue(self.module.capsule_has_state_archive(capsule))
            archive.unlink(); archive.symlink_to('missing')
            self.assertTrue(self.module.capsule_has_state_archive(capsule))

    def test_capacity_protection_uses_current_roots_and_extant_archives(self):
        m = self.module
        with tempfile.TemporaryDirectory() as folder:
            m.STATE = Path(folder)/'state'; m.BACKUPS = Path(folder)/'backups'
            m.CAPACITY_MODE = True; m.SHA = m.CAPACITY_SOURCE; m.EXPECTED = sorted(m.CAPACITY_TARGETS)
            core = dict(zip(('server', 'report-worker', 'web', 'caddy'), self.ids, strict=True))
            plan = {'release_sha': m.SHA, 'candidate_images': core, 'manifest_sha256': 'f'*64}
            marker = {'plan_sha256': m.digest(plan), 'acceptance': {**plan, 'state': 'RELEASE_CANDIDATE_ACCEPTED'}}
            documents = {m.STATE/'release-runtime/trial-plan.json': plan,
                         m.STATE/'release-accepted.json': marker,
                         m.STATE/'release-runtime/stage.json': {'release_sha': m.CAPACITY_CANDIDATE}}
            targets = list(m.CAPACITY_TARGETS)
            for index, identity in enumerate(targets):
                documents[m.BACKUPS/('worker-'+str(index))/'runtime.json'] = {'image': identity}
            for path, body in documents.items():
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(body))
            m.owned = lambda path, **kwargs: path.read_bytes()
            containers = [{'Id': str(index)*64, 'Name': '/aemr-'+role+'-1', 'Image': identity,
                           'Config': {'Labels': {'com.docker.compose.project': 'aemr', 'com.docker.compose.service': role}},
                           'State': {'Status': 'running', 'OOMKilled': False, 'Health': {'Status': 'healthy'}},
                           'Mounts': [], 'RestartCount': 0} for index, (role, identity) in enumerate(core.items(), 1)]
            images = [{'Id': identity, 'RepoTags': ['aemr-server:release-'+source], 'RepoDigests': [],
                       'Config': {'Labels': {'org.opencontainers.image.revision': source}}}
                      for identity, source in m.CAPACITY_TARGETS.items()]
            def command(arguments):
                if arguments[:2] == ['ps', '--all']: return '\n'.join(row['Id'] for row in containers)
                if arguments[0] == 'inspect': return json.dumps(containers)
                if arguments[:2] == ['image', 'ls']: return '\n'.join(targets)
                return json.dumps(images)
            m.command = command
            before = m.observe(); self.assertEqual(before['selected'], sorted(targets))
            diagnostic = m.observe(diagnostics=True)
            self.assertTrue(all(row['exact_metadata'] for row in diagnostic.pop('capacity_eligibility').values()))
            self.assertEqual(diagnostic, before)
            archive = m.BACKUPS/'worker-0'/'backup'/'state.tar.gz'
            archive.parent.mkdir(); archive.write_bytes(b'archive')
            protected = m.observe()
            self.assertEqual(protected['selected'], [targets[1]])
            self.assertEqual(protected['protected_selected_ids'], [targets[0]])
            self.assertNotEqual(before['reference_digest'], protected['reference_digest'])
            (m.STATE/'release-runtime/stage.json').write_text(json.dumps({'release_sha': '0'*40}))
            with self.assertRaises(ValueError): m.observe()

    def test_active_stopped_rollback_and_tagged_images_are_preserved(self):
        containers=[{'Image':self.ids[0],'State':{'Status':'exited'}}]
        protected=self.module.references({'previous':{'image':self.ids[1]},'private':'PRIVATE_SECRET'})
        self.images[2]['RepoTags']=['PRIVATE_TAG']
        self.assertEqual(self.module.select_images(self.images,containers,protected,self.ids),[self.ids[3]])

    def test_failed_build_selection_preserves_current_candidate_and_all_historical_images(self):
        failed=['sha256:496aaab4a99a9f861e1c2a930d28db8d0dd2d7bbe3832e5acbbfd8d4716d32aa',
                'sha256:dad30bd43487e748d44170e21f86a02d10d9426c22144d35676a20a38e649390']
        images=[{'Id':identity,'RepoTags':[],'RepoDigests':[]} for identity in failed+self.ids]
        selected=self.module.select_images(images,[],set(),self.module.EXPECTED)
        self.assertEqual(selected,sorted(failed))
        self.assertEqual(self.module.select_images(images,[{'Image':failed[0]}],{failed[1]},self.module.EXPECTED),[])

    def test_registry_digest_or_unselected_image_is_not_retired(self):
        self.images[0]['RepoDigests']=['PRIVATE_DIGEST']
        self.assertEqual(self.module.select_images(self.images,[],set(),self.ids[:2]),[self.ids[1]])

    def test_actual_removal_cannot_prune_unselected_parent_images(self):
        calls=[]
        self.module.command=lambda arguments:calls.append(arguments)
        self.module.remove_image(self.ids[0])
        self.assertEqual(calls,[['image','rm','--no-prune',self.ids[0]]])

    def test_dangling_custody_marker_blocks_before_reference_reads(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.module.STATE=Path(temporary)
            (self.module.STATE/'pending-release.json').symlink_to('missing')
            (self.module.STATE/'release-accepted.json').write_text('{}')
            self.module.owned=lambda path:(_ for _ in ()).throw(AssertionError('custody marker bypassed'))
            with self.assertRaises(ValueError):self.module.observe()

    def test_native_child_inherits_actual_lock_descriptor(self):
        original=subprocess.run
        with tempfile.TemporaryFile() as lock:
            self.module.LOCK_FD=lock.fileno()
            program='import json,os,sys;print(json.dumps(os.fstat(int(sys.argv[1])).st_ino))'
            def child(arguments,**kwargs):
                return original([sys.executable,'-IB','-c',program,str(lock.fileno())],**kwargs)
            with patch.object(self.module.subprocess,'run',side_effect=child):
                self.assertEqual(json.loads(self.module.command(['image','rm','--no-prune',self.ids[0]])),os.fstat(lock.fileno()).st_ino)

    def test_legacy_operator_metadata_can_only_add_protection_not_authorize(self):
        import contextlib
        import io
        original=os.fstat
        def legacy_owner(fd):
            fields=list(original(fd));fields[4]=1000
            return os.stat_result(fields)
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'legacy.json';path.write_text(json.dumps({'image':self.ids[0]}));path.chmod(0o600)
            with patch.object(self.module.os,'fstat',side_effect=legacy_owner),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError):self.module.owned(path)
                self.assertEqual(self.module.references(json.loads(self.module.owned(path,reference_only=True))),{self.ids[0]})

    def test_completed_cleanup_can_resume_only_with_the_exact_durable_receipt_and_no_new_reference(self):
        self.assertTrue(callable(getattr(self.module,'verify_completed',None)),'Completed cleanup needs an exact receipt admission')
        self.module.SOURCE_SHA256='f'*64
        result={'status':'UNREFERENCED_IMAGES_RETIRED_RUNTIME_UNCHANGED','removed':2,
                'selected_ids':self.module.EXPECTED,'operator_sha256':'f'*64,'source_sha':self.module.SHA}
        current={'selected':[],'protected_selected_ids':[]}
        self.module.verify_completed(result,current)
        for change in ({'operator_sha256':'e'*64},{'source_sha':'0'*40},{'removed':1},
                       {'selected_ids':self.module.EXPECTED[:1]},{'status':'INTENT'}):
            with self.subTest(change=change),self.assertRaises(ValueError):
                self.module.verify_completed({**result,**change},current)
        for change in ({'selected':self.module.EXPECTED[:1]},{'protected_selected_ids':self.module.EXPECTED[:1]}):
            with self.subTest(change=change),self.assertRaises(ValueError):
                self.module.verify_completed(result,{**current,**change})

    def test_receipt_commit_syncs_the_parent_directory_after_atomic_replace(self):
        import stat
        calls=[];original=os.fsync
        def sync(fd):
            calls.append(stat.S_ISDIR(os.fstat(fd).st_mode));return original(fd)
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'result.json'
            with patch.object(self.module.os,'fsync',side_effect=sync):
                self.module.atomic_json(target,{'result':'verified'})
            self.assertEqual(json.loads(target.read_text()),{'result':'verified'})
        self.assertEqual(calls,[False,True],'Receipt needs both file and directory fsync')

    def test_invalid_or_duplicate_identifiers_fail_closed(self):
        for selected in ([self.ids[0],self.ids[0]],['PRIVATE_ID']):
            with self.assertRaises(ValueError):self.module.select_images(self.images,[],set(),selected)

    def test_changed_reference_or_runtime_prevents_first_removal(self):
        before={'selected':[self.ids[0]],'reference_digest':'before','runtime_digest':'runtime'}
        for key in ('selected','reference_digest','runtime_digest'):
            current=copy.deepcopy(before);current[key]='changed'
            removed=[]
            with self.assertRaises(ValueError):self.module.retire(before,lambda current=current:current,removed.append)
            self.assertEqual(removed,[])

    def test_each_removal_rechecks_all_references_and_never_uses_force(self):
        plan={'selected':self.ids[:2],'reference_digest':'same','runtime_digest':'same'}
        removed=[]
        def observe():return {**plan,'selected':[value for value in plan['selected'] if value not in removed]}
        self.module.retire(plan,observe,removed.append)
        self.assertEqual(removed,self.ids[:2])

    def test_mid_operation_new_reference_stops_remaining_removals(self):
        plan={'selected':self.ids[:2],'reference_digest':'same','runtime_digest':'same'}
        removed=[]
        def observe():
            return {**plan,'selected':plan['selected'] if not removed else []}
        with self.assertRaises(ValueError):self.module.retire(plan,observe,removed.append)
        self.assertEqual(removed,self.ids[:1])


if __name__=='__main__':unittest.main()
