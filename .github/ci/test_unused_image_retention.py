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

    def test_active_stopped_rollback_and_tagged_images_are_preserved(self):
        containers=[{'Image':self.ids[0],'State':{'Status':'exited'}}]
        protected=self.module.references({'previous':{'image':self.ids[1]},'private':'PRIVATE_SECRET'})
        self.images[2]['RepoTags']=['PRIVATE_TAG']
        self.assertEqual(self.module.select_images(self.images,containers,protected,self.ids),[self.ids[3]])

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
            (self.module.STATE/'release-marker.json').write_text('{}')
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
