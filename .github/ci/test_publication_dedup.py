"""Physical sharing preserves the exact paths and bytes consumed by old readers."""
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT=Path(__file__).with_name('publication_dedup.py')

class PublicationDedupTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('dedup',SCRIPT)
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'data';self.stage=self.root/'stage';self.stage.mkdir()
        self.files={};self.catalog={}
        for i in (1,2,3):
            rid='REL-'+str(i)*64;relative=f'reports/published/releases/{rid}/snapshot_bundle/payloads/source.json'
            path=self.source/relative;path.parent.mkdir(parents=True);path.write_bytes(b'{"value":"same"}')
            info=path.stat();digest=hashlib.sha256(path.read_bytes()).hexdigest()
            self.files[relative]={'sha256':digest,'bytes':info.st_size,'uid':info.st_uid,'gid':info.st_gid,'mode':info.st_mode&0o7777}
            self.catalog[rid]={'snapshot_bundle/payloads/source.json':digest}
        self.paths=[self.source/name for name in self.files]

    def plan(self):return self.m.plan_dedup(self.source,self.files,self.catalog,min_bytes=1)

    def test_exact_bytes_and_directory_entry_sets_are_preserved_for_lockless_readers(self):
        before={str(p.relative_to(self.source)):p.read_bytes() for p in self.source.rglob('*') if p.is_file()}
        checked=[]
        def observer():
            self.assertEqual({str(p.relative_to(self.source)):p.read_bytes() for p in self.source.rglob('*') if p.is_file()},before)
            checked.append(True)
        result=self.m.apply_dedup(self.source,self.plan(),self.stage,observe=observer)
        self.assertEqual(result['linked_files'],2);self.assertEqual(len(checked),2)
        self.assertEqual(len({p.stat().st_ino for p in self.paths}),1)
        self.assertEqual(list(self.stage.iterdir()),[])
        self.assertEqual(self.m.apply_dedup(self.source,self.plan(),self.stage)['linked_files'],0)

    def test_unregistered_paths_changed_hash_and_changed_permissions_are_rejected(self):
        for scenario in ('catalog','hash','mode'):
            with self.subTest(scenario=scenario):
                original=self.paths[0].read_bytes();mode=self.paths[0].stat().st_mode&0o7777
                catalog={key:dict(value) for key,value in self.catalog.items()}
                if scenario=='catalog':self.catalog.clear()
                elif scenario=='hash':self.paths[0].write_bytes(b'{"value":"fake"}')
                else:self.paths[0].chmod(0o400)
                with self.assertRaises(ValueError):self.plan()
                self.paths[0].chmod(mode);self.paths[0].write_bytes(original);self.catalog=catalog

    def test_symlink_and_external_alias_are_rejected_before_mutation(self):
        alias=self.root/'external';os.link(self.paths[0],alias)
        with self.assertRaisesRegex(ValueError,'EXTERNAL_LINK'):self.plan()
        alias.unlink();original=self.paths[0].read_bytes();self.paths[0].unlink();self.paths[0].symlink_to(self.paths[1])
        with self.assertRaises(ValueError):self.plan()
        self.paths[0].unlink();self.paths[0].write_bytes(original)

    def test_change_after_plan_is_rejected_without_linking(self):
        plan=self.plan();self.paths[-1].write_bytes(b'{"value":"fake"}')
        with self.assertRaises(ValueError):self.m.apply_dedup(self.source,plan,self.stage)
        self.assertEqual(len({p.stat().st_ino for p in self.paths}),3)

    def test_sqlite_and_unregistered_json_are_not_eligible(self):
        target=self.paths[0].with_suffix('.sqlite');target.write_bytes(self.paths[0].read_bytes())
        self.files[str(target.relative_to(self.source))]=dict(next(iter(self.files.values())))
        result=self.plan();self.assertEqual(sum(len(group) for group in result),3)

    def test_staging_inside_release_tree_is_rejected(self):
        with self.assertRaises(ValueError):self.m.apply_dedup(self.source,self.plan(),self.paths[0].parent)

    def test_external_link_created_after_plan_is_rejected(self):
        plan=self.plan();os.link(self.paths[0],self.root/'external')
        with self.assertRaisesRegex(ValueError,'EXTERNAL_LINK'):self.m.apply_dedup(self.source,plan,self.stage)
        self.assertEqual(len({p.stat().st_ino for p in self.paths}),3)

    def test_interrupted_replacement_preserves_content_and_can_resume(self):
        def interrupted():raise RuntimeError('synthetic interruption')
        with self.assertRaises(RuntimeError):self.m.apply_dedup(self.source,self.plan(),self.stage,observe=interrupted)
        self.assertEqual(list(self.stage.iterdir()),[])
        self.assertTrue(all(p.read_bytes()==b'{"value":"same"}' for p in self.paths))
        self.m.apply_dedup(self.source,self.plan(),self.stage)
        self.assertEqual(len({p.stat().st_ino for p in self.paths}),1)

    def test_source_replaced_during_link_never_publishes_unchecked_bytes(self):
        plan=self.plan();original_link=os.link;changed=False
        expected=self.paths[1].read_bytes()
        def raced_link(source,destination,**kwargs):
            nonlocal changed
            if not changed:
                changed=True
                replacement=self.root/'replacement.json'
                replacement.write_bytes(b'{"value":"fake"}')
                os.replace(replacement,source)
            return original_link(source,destination,**kwargs)
        with patch.object(self.m.os,'link',side_effect=raced_link),self.assertRaises(ValueError):
            self.m.apply_dedup(self.source,plan,self.stage)
        self.assertTrue(changed)
        self.assertTrue(all(path.read_bytes()==expected for path in self.paths[1:]))
        self.assertEqual(list(self.stage.iterdir()),[])

    def test_external_alias_created_during_link_cannot_be_reported_verified(self):
        plan=self.plan();original_link=os.link;changed=False
        def raced_link(source,destination,**kwargs):
            nonlocal changed
            if not changed:
                changed=True
                original_link(source,self.root/'external')
            return original_link(source,destination,**kwargs)
        with patch.object(self.m.os,'link',side_effect=raced_link),self.assertRaisesRegex(ValueError,'EXTERNAL_LINK'):
            self.m.apply_dedup(self.source,plan,self.stage)
        self.assertTrue(changed)
        self.assertTrue(all(path.read_bytes()==b'{"value":"same"}' for path in self.paths))

@unittest.skipUnless(os.geteuid()==0,'private checkpoint receipts require actual root')
class CheckpointRetirementTests(unittest.TestCase):
    def setUp(self):
        path=SCRIPT.with_name('test_release_recovery.py')
        spec=importlib.util.spec_from_file_location('checkpoint_fixtures',path)
        fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)
        self.f=fixtures.ReleaseRecoveryTests();self.addCleanup(self.f.doCleanups);self.f.setUp()
        self.r=self.f.module
        spec=importlib.util.spec_from_file_location('dedup',SCRIPT)
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        with patch.dict(sys.modules,{'release_recovery':self.r}):
            spec=importlib.util.spec_from_file_location('release_trial',self.f.trusted_source('deploy/release_trial.py'))
            trial=importlib.util.module_from_spec(spec);spec.loader.exec_module(trial)
            with patch.dict(sys.modules,{'release_trial':trial}):
                spec=importlib.util.spec_from_file_location('checkpoint_controller',self.f.trusted_source('deploy/release-controller.py'))
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.controller=module.ReleaseController(self.f.executor)
        self.old=self.r.BACKUP_BASE/'worker-122/backup';self.old.parent.mkdir(mode=0o700)
        shutil.copytree(self.f.backup,self.old)
        self.binding={'backup_reference':'worker-122/backup','manifest_sha256':self.r.digest((self.old/'manifest.json').read_bytes())}
        self.r.atomic_json(self.r.RUNTIME_DIR/'previous-checkpoint.json',self.binding)
        for service in ('server','report-worker'):self.f.records[service]['State']['Status']='exited'
        self.f.persist_records()
        self.r.atomic_json(self.r.RUNTIME_DIR/'stage.json',{'container_ids':{s:v['Id'] for s,v in self.f.records.items()}})

    def retire(self):return self.controller._retire_previous_checkpoint(self.f.plan)

    def test_verified_replacement_keeps_both_manifests_and_fresh_archive(self):
        self.retire()
        self.assertFalse((self.old/'state.tar.gz').exists())
        self.assertTrue((self.old/'manifest.json').is_file())
        self.assertTrue((self.f.backup/'state.tar.gz').is_file())
        self.assertEqual(json.loads((self.old/'superseded-retirement.json').read_bytes())['retained_manifest_sha256'],self.f.plan['manifest_sha256'])
        self.retire()  # Durable binding makes retry safe after unlink.

    def test_bad_old_binding_running_writer_and_changed_new_archive_preserve_old(self):
        for scenario in ('old-binding','writer','new-archive'):
            with self.subTest(scenario=scenario):
                old_binding=(self.r.RUNTIME_DIR/'previous-checkpoint.json').read_bytes()
                archive=self.f.backup/'state.tar.gz';original=archive.read_bytes()
                if scenario=='old-binding':self.r.atomic_json(self.r.RUNTIME_DIR/'previous-checkpoint.json',{**self.binding,'manifest_sha256':'f'*64})
                elif scenario=='writer':self.f.records['server']['State']['Status']='running';self.f.persist_records()
                else:archive.write_bytes(b'fake')
                with self.assertRaises((ValueError,self.r.RecoveryError)):self.retire()
                self.assertTrue((self.old/'state.tar.gz').is_file())
                self.r.atomic_bytes(self.r.RUNTIME_DIR/'previous-checkpoint.json',old_binding)
                archive.write_bytes(original);self.f.records['server']['State']['Status']='exited';self.f.persist_records()

    def test_insufficient_net_restore_capacity_rejects_before_deletion(self):
        from types import SimpleNamespace
        with patch.object(shutil,'disk_usage',return_value=SimpleNamespace(free=0)),self.assertRaisesRegex(ValueError,'CAPACITY'):
            self.retire()
        self.assertTrue((self.old/'state.tar.gz').is_file())

    def test_never_retires_the_replacement_itself(self):
        self.r.atomic_json(self.r.RUNTIME_DIR/'previous-checkpoint.json',{'backup_reference':self.f.plan['backup_reference'],'manifest_sha256':self.f.plan['manifest_sha256']})
        with self.assertRaises(ValueError):self.retire()
        self.assertTrue((self.f.backup/'state.tar.gz').is_file())

@unittest.skipUnless(os.geteuid()==0,'actual root metadata for bundled maintenance callback')
class RestoredRuntimeDedupTests(unittest.TestCase):
    def test_actual_callback_preserves_inventory_quarantine_and_old_word_proof(self):
        import sqlite3
        spec=importlib.util.spec_from_file_location('lineage_fixtures',SCRIPT.with_name('test_rollback_lineage.py'))
        fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)
        f=fixtures.LineageTests();self.addCleanup(f.doCleanups);f.setUp()
        source=f.f.source;root=source/'reports/published';(root/'publication.lock').touch()
        with sqlite3.connect(root/'publications.sqlite') as db:
            db.execute('create table publications(release_id text,files text)')
            for i in (1,2,3):
                release='REL-'+str(i)*64;name='snapshot_bundle/payloads/source.json'
                path=root/'releases'/release/name;path.parent.mkdir(parents=True)
                path.write_bytes(b'{"value":"'+b'x'*(1024**2)+b'"}')
                db.execute('insert into publications values(?,?)',(release,json.dumps({name:hashlib.sha256(path.read_bytes()).hexdigest()})))
        backup=f.r.BACKUP_BASE/'worker-124/backup';backup.parent.mkdir(mode=0o700)
        f.f.backup_tool.create(source,backup,compressed=True)
        f.plan['backup_reference']='worker-124/backup'
        f.plan['manifest_sha256']=f.r.digest((backup/'manifest.json').read_bytes())
        restored=f.f.backup_tool.restore_state(backup,source,f.plan['manifest_sha256'])
        f.r.atomic_json(f.r.STATE_DIR/'release-recovered.json',{
            'state':'RELEASE_RUNTIME_AND_STATE_RECOVERED','release_sha':f.plan['release_sha'],
            'plan_sha256':f.r.digest(json.dumps(f.plan,sort_keys=True,separators=(',',':')).encode()),
            'manifest_sha256':f.plan['manifest_sha256'],'restored':restored})
        spec=importlib.util.spec_from_file_location('dedup_callback',SCRIPT)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        module.record_lineage=f.m.record_lineage
        before=f.f.backup_tool.inventory(source)
        module.deduplicate_immutable_payloads(f.f.executor,f.r,f.plan)
        self.assertEqual(f.f.backup_tool.inventory(source),before)
        self.assertEqual((f.qdir/'quarantine.json').read_bytes(),f.qbytes)
        self.assertEqual(json.loads((f.r.STATE_DIR/'publication-dedup/result.json').read_bytes())['linked_files'],2)

if __name__=='__main__':unittest.main()
