"""A recoverable image archive must bind the exact image and reject unsafe inputs."""
import gzip
import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT=Path(__file__).with_name('image_archive.py')


class ImageArchiveTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(),'Bounded image archive operator is missing')
        spec=importlib.util.spec_from_file_location('image_archive',SCRIPT)
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.image={'Id':self.m.IMAGE,'RepoTags':[self.m.TAG],
                    'Config':{'Labels':{'org.opencontainers.image.revision':self.m.SOURCE},'Env':['PRIVATE=value']},
                    'RootFS':{'Type':'layers','Layers':['sha256:'+'1'*64]},'Os':'linux','Architecture':'amd64'}

    def test_unreferenced_exact_image_is_admitted_without_exposing_config(self):
        result=self.m.admit_image(self.image,[],{'sha256:'+'a'*64})
        self.assertEqual(result,{'image_id':self.m.IMAGE,'source_sha':self.m.SOURCE,'tag':self.m.TAG})
        self.assertNotIn('PRIVATE',json.dumps(result))

    def test_running_stopped_protected_or_retagged_images_never_qualify(self):
        for status in ('running','exited','created'):
            with self.subTest(status=status),self.assertRaises(ValueError):
                self.m.admit_image(self.image,[{'Image':self.m.IMAGE,'State':{'Status':status}}],set())
        with self.assertRaises(ValueError):self.m.admit_image(self.image,[],{self.m.IMAGE})
        for changed in ({'Id':'sha256:'+'f'*64},{'RepoTags':[self.m.TAG,'extra:tag']},
                        {'Config':{'Labels':{'org.opencontainers.image.revision':'f'*40}}}):
            with self.subTest(changed=changed),self.assertRaises(ValueError):
                self.m.admit_image({**self.image,**changed},[],set())

    def test_independent_load_must_preserve_image_configuration_and_ordered_layers(self):
        self.m.verify_loaded_image(self.image,json.loads(json.dumps(self.image)))
        for changed in ({'Id':'sha256:'+'f'*64},{'RootFS':{'Type':'layers','Layers':[]}},
                        {'Config':{}},{'Os':'windows'},{'RepoTags':[]}):
            with self.subTest(changed=changed),self.assertRaises(ValueError):
                self.m.verify_loaded_image(self.image,{**self.image,**changed})

    def test_roundtrip_preserves_every_registry_reference_without_losing_multiplicity(self):
        refs=['aemr-server@sha256:'+'b'*64,'other/repository@sha256:'+'a'*64]
        original={**self.image,'RepoDigests':refs}
        self.m.verify_loaded_image(original,{**original,'RepoDigests':list(reversed(refs))})
        for changed in (None,[],refs[:1],[refs[0],refs[0]],[*refs,refs[0]],'invalid'):
            with self.subTest(changed=changed),self.assertRaisesRegex(ValueError,'REGISTRY_REFERENCE'):
                self.m.verify_loaded_image(original,{**original,'RepoDigests':changed})

    def test_compression_preserves_bytes_with_an_exclusive_private_output(self):
        with tempfile.TemporaryDirectory() as folder:
            raw=Path(folder)/'raw.tar';target=Path(folder)/'archive.gz'
            body=b'bounded immutable image archive\0'*10000;raw.write_bytes(body)
            result=self.m.compress_archive(raw,target,max_bytes=1024**2,reserve_bytes=1024)
            self.assertEqual(gzip.decompress(target.read_bytes()),body)
            self.assertEqual(result,{'archive_bytes':target.stat().st_size,
                                    'archive_sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
            self.assertEqual(target.stat().st_mode&0o777,0o600)
            with self.assertRaises(FileExistsError):
                self.m.compress_archive(raw,target,max_bytes=1024**2,reserve_bytes=1024)
            self.assertEqual(gzip.decompress(target.read_bytes()),body)

    def test_space_and_compressed_size_failures_preserve_source_without_an_accepted_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            raw=Path(folder)/'raw.tar';target=Path(folder)/'archive.gz';raw.write_bytes(bytes(range(256))*1000)
            with patch.object(self.m.shutil,'disk_usage',return_value=SimpleNamespace(free=0)),self.assertRaisesRegex(ValueError,'SPACE'):
                self.m.compress_archive(raw,target,max_bytes=1024,reserve_bytes=1024)
            self.assertFalse(target.exists())
            with self.assertRaisesRegex(ValueError,'SIZE'):
                self.m.compress_archive(raw,target,max_bytes=10,reserve_bytes=0)
            self.assertFalse(target.exists())
            self.assertEqual(raw.read_bytes(),bytes(range(256))*1000)

    def test_roundtrip_receipt_is_bound_to_archive_metadata_engine_and_attempt(self):
        ready={'image_id':self.m.IMAGE,'source_sha':self.m.SOURCE,'tag':self.m.TAG,
               'archive_bytes':100,'archive_sha256':'a'*64,'image_metadata_sha256':'b'*64}
        receipt={**ready,'state':'IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED','runner_engine_version':'29.1.3',
                 'run_id':'123','run_attempt':'1','ops_sha':'c'*40}
        self.assertEqual(self.m.check_receipt(ready,receipt),receipt)
        for changed in ({'archive_sha256':'d'*64},{'image_metadata_sha256':'d'*64},
                        {'runner_engine_version':'28.0.0'},{'run_id':'../123'},{'private':'value'}):
            with self.subTest(changed=changed),self.assertRaises(ValueError):
                self.m.check_receipt(ready,{**receipt,**changed})

    def runtime_fixture(self):
        current=self.m.CURRENT_IMAGES
        plan={'release_sha':self.m.ACCEPTED_SOURCE,'manifest_sha256':'d'*64,
              'candidate_images':current,'images':{role:'sha256:'+str(i+1)*64 for i,role in enumerate(current)},
              'config_sha256':{'compose.json':'e'*64},'word':{'sha256':{'main':'f'*64}}}
        acceptance={'state':'RELEASE_CANDIDATE_ACCEPTED','release_sha':plan['release_sha'],
                    'manifest_sha256':plan['manifest_sha256'],'candidate_images':current,
                    'config_sha256':plan['config_sha256'],'word_sha256':plan['word']['sha256']}
        marker={'plan_sha256':hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                'acceptance':acceptance}
        stage={'release_sha':self.m.PENDING_SOURCE,'images':current,
               'candidate_images':{role:'sha256:'+str(i+5)*64 for i,role in enumerate(current)}}
        containers=[{'Id':str(i+1)*64,'Name':'/aemr-'+role+'-1','Image':image,'RestartCount':0,
                     'Config':{'Labels':{'com.docker.compose.project':'aemr','com.docker.compose.service':role}},
                     'State':{'Status':'running','OOMKilled':False,'Health':{'Status':'healthy'}}}
                    for i,(role,image) in enumerate(current.items())]
        return plan,marker,stage,containers

    def test_runtime_admission_requires_the_accepted_cohort_and_pending_candidate(self):
        plan,marker,stage,containers=self.runtime_fixture()
        current=self.m.CURRENT_IMAGES
        protected=self.m.admit_runtime(plan,marker,stage,containers)
        self.assertEqual(protected,set(current.values())|set(plan['images'].values())|set(stage['candidate_images'].values()))
        for target,changed in [('plan',{'release_sha':'f'*40}),('marker',{'plan_sha256':'f'*64}),
                               ('stage',{'release_sha':'f'*40})]:
            values={'plan':plan,'marker':marker,'stage':stage}
            values[target]={**values[target],**changed}
            with self.subTest(target=target),self.assertRaises(ValueError):
                self.m.admit_runtime(values['plan'],values['marker'],values['stage'],containers)
        for update in ({'Image':self.m.IMAGE},{'RestartCount':1},{'State':{'Status':'exited'}}):
            with self.subTest(update=update),self.assertRaises(ValueError):
                self.m.admit_runtime(plan,marker,stage,[{**containers[0],**update},*containers[1:]])

    def test_mount_permutation_preserves_runtime_proof_but_changed_mounts_and_settings_do_not(self):
        plan,marker,stage,containers=self.runtime_fixture()
        containers[0]['Mounts']=[{'Type':'volume','Source':'one','Destination':'/data','RW':True},
                                 {'Type':'bind','Source':'two','Destination':'/config','RW':False}]
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            directories={key:base/key for key in ('STATE_DIR','RUNTIME_DIR','BACKUP_BASE')}
            for path in directories.values():path.mkdir(mode=0o700)
            r=SimpleNamespace(**directories,private_directory=lambda path:None,
                              read_owned=lambda path,**kwargs:path.read_bytes())
            for path,value in [(r.RUNTIME_DIR/'trial-plan.json',plan),(r.RUNTIME_DIR/'stage.json',stage),
                               (r.STATE_DIR/'release-accepted.json',marker)]:path.write_text(json.dumps(value))
            def command(args,**kwargs):
                if args[0]=='ps':return '\n'.join(row['Id'] for row in containers)
                self.assertEqual(args[0],'inspect');return json.dumps(containers)
            before=self.m.runtime_context(r,command)[0]
            containers[0]['Mounts'].reverse()
            self.assertEqual(self.m.runtime_context(r,command)[0],before)
            for update in ({'Source':'other'},{'Destination':'/other'},{'RW':True}):
                original=containers[0]['Mounts'][0]
                containers[0]['Mounts'][0]={**original,**update}
                self.assertNotEqual(self.m.runtime_context(r,command)[0],before)
                containers[0]['Mounts'][0]=original
            containers[0]['HostConfig']={'Memory':123456}
            self.assertNotEqual(self.m.runtime_context(r,command)[0],before)

    def staged_fixture(self):
        plan,marker,stage,_containers=self.runtime_fixture()
        stage['format']='aemr-release-stage-v1'
        stage['candidate_images']={
            'server':'sha256:f5b6e96262e81176a4752857a1a209121322b6b1c3113ca4fbb7a69d1f030d57',
            'report-worker':'sha256:f5b6e96262e81176a4752857a1a209121322b6b1c3113ca4fbb7a69d1f030d57',
            'web':'sha256:5728022e239d7d03b4ecc914913088932af03f319e2d12c256f8c437e33b8c20',
            'caddy':self.m.CURRENT_IMAGES['caddy']}
        source=Path(__file__).resolve().parent/'source_ci_gate.py'
        ci={'run':{'head_sha':self.m.PENDING_SOURCE,'name':'CI','event':'pull_request',
                   'path':'.github/workflows/ci.yml','head_repository':{'full_name':'gaben1488/dash'}},
            'jobs':[{'name':name,'status':'completed','conclusion':'success'} for name in (
                'Lint, TypeScript, Tests, Build, Audit','Report engine, publication and runtime',
                'Production image with report runtime')],
            'candidate_image_binding':{'source_sha':self.m.PENDING_SOURCE,'images':stage['candidate_images']}}
        gate=Path('/usr/local/libexec/aemr/source_ci_gate.py')
        def encode(value):return json.dumps(value,sort_keys=True,allow_nan=False).encode()
        stage['source_ci_sha256']=hashlib.sha256(encode(ci)).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);runtime=base/'runtime'
            files={runtime/'trial-plan.json':encode(plan),base/'state/release-accepted.json':encode(marker),
                   runtime/'source-ci.json':encode(ci),gate:source.read_bytes()}
            config_names=('compose.json','.env.production','Caddyfile','candidate-compose.json','candidate-Caddyfile')
            for name in config_names:files[runtime/name]=b'private configuration '+name.encode()
            stage['config_sha256']={name:hashlib.sha256(files[runtime/name]).hexdigest() for name in config_names}
            files[runtime/'stage.json']=encode(stage)
            images=[{'Id':identity,'Config':{'Labels':{'org.opencontainers.image.revision':self.m.PENDING_SOURCE}}}
                    for identity in dict.fromkeys(stage['candidate_images'][role] for role in ('server','web'))]
            r=SimpleNamespace(RUNTIME_DIR=runtime,CONFIG_FILES=config_names,
                              require_lock=lambda fd:None,read_owned=lambda path,**kwargs:files[path])
            frame={'stage':hashlib.sha256(files[runtime/'stage.json']).hexdigest(),'stable':'runtime'}
            def command(args,**kwargs):
                self.assertEqual(args,['image','inspect',*dict.fromkeys(stage['candidate_images'][role] for role in ('server','web'))])
                return json.dumps(images)
            yield r,stage,ci,files,images,frame,command,encode

    def test_existing_candidate_binds_actual_images_source_ci_and_every_configuration_file(self):
        for r,stage,ci,files,images,frame,command,encode in self.staged_fixture():
            # No lookup or reload of the retired historical43 image is permitted.
            with patch.object(self.m,'runtime_context',return_value=(frame,[],set())):
                result=self.m.staged_candidates(r,command,9)
            self.assertEqual(result['candidate_images'],stage['candidate_images'])
            self.assertEqual(result['images'],self.m.CURRENT_IMAGES)
            self.assertEqual(result['source_sha'],self.m.PENDING_SOURCE)
            self.assertNotIn('private configuration',json.dumps(result))

    def test_existing_candidate_rejects_old_source_ci_binding_labels_config_and_stage_drift(self):
        for defect in ('old_source','ci','binding','label','config','stage_drift','gate'):
            for r,stage,ci,files,images,frame,command,encode in self.staged_fixture():
                if defect=='old_source':stage['release_sha']=self.m.SOURCE
                elif defect=='ci':ci['jobs'][0]['conclusion']='failure'
                elif defect=='binding':ci['candidate_image_binding']['images']={**stage['candidate_images'],'web':self.m.IMAGE}
                elif defect=='label':images[0]['Config']['Labels']['org.opencontainers.image.revision']=self.m.SOURCE
                elif defect=='config':files[r.RUNTIME_DIR/'compose.json']=b'changed'
                elif defect=='gate':files[Path('/usr/local/libexec/aemr/source_ci_gate.py')]=b'unsafe code'
                files[r.RUNTIME_DIR/'source-ci.json']=encode(ci)
                stage['source_ci_sha256']=hashlib.sha256(encode(ci)).hexdigest()
                files[r.RUNTIME_DIR/'stage.json']=encode(stage)
                frame['stage']=hashlib.sha256(files[r.RUNTIME_DIR/'stage.json']).hexdigest()
                contexts=[(frame,[],set()),({**frame,'stable':'changed'} if defect=='stage_drift' else frame,[],set())]
                with self.subTest(defect=defect),patch.object(self.m,'runtime_context',side_effect=contexts),self.assertRaises(ValueError):
                    self.m.staged_candidates(r,command,9)

    def test_image_reference_permutation_is_equivalent_but_reference_changes_are_detected(self):
        image={**self.image,'RepoTags':[self.m.TAG,'other:tag'],
               'RepoDigests':['one@sha256:'+'a'*64,'two@sha256:'+'b'*64]}
        def command(args,**kwargs):
            return self.m.IMAGE if args[1]=='ls' else json.dumps([image])
        before=self.m.image_inventory(command)
        image['RepoTags'].reverse();image['RepoDigests'].reverse()
        self.assertEqual(self.m.image_inventory(command),before)
        image['RepoTags'].append('new:tag')
        self.assertNotEqual(self.m.image_inventory(command),before)
        image['RepoTags'].pop();image['RepoDigests'].pop()
        self.assertNotEqual(self.m.image_inventory(command),before)

    def test_recovery_loader_rejects_unpinned_or_symlinked_code(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'release_recovery.py';source.write_text('raise RuntimeError("must not execute")')
            source.chmod(0o600)
            with self.assertRaises(ValueError):self.m.load_recovery(source)
            alias=Path(folder)/'alias.py';alias.symlink_to(source)
            with self.assertRaises(ValueError):self.m.load_recovery(alias)

    def test_failed_raw_cleanup_cannot_publish_a_ready_archive(self):
        # Only root/Docker boundaries are substituted here. Real compression,
        # directory entries and the failing unlink exercise the crash window.
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);raw=base/'image.tar.pending'
            def write(path,value):path.write_text(json.dumps(value));path.chmod(0o600)
            r=SimpleNamespace(require_lock=lambda fd:None,private_directory=lambda path:None,
                atomic_json=write,fsync_directory=lambda path:None,read_owned=lambda path:path.read_bytes())
            original=Path.unlink
            def unlink(path,*args,**kwargs):
                if path==raw:raise OSError('isolated scratch cleanup failure')
                return original(path,*args,**kwargs)
            with patch.object(self.m,'current_context',return_value=({'stable':True},self.image)), \
                 patch.object(self.m,'export_image',side_effect=lambda path,fd:path.write_bytes(b'image bytes')), \
                 patch.object(Path,'unlink',unlink),self.assertRaises(OSError):
                self.m.prepare(r,None,base,9)
            self.assertTrue(raw.exists())
            self.assertFalse((base/'ready.json').exists(),'READY must not precede raw scratch cleanup')

    def test_retirement_requires_the_specific_independent_roundtrip_not_an_arbitrary_receipt(self):
        ready={'image_id':self.m.IMAGE,'source_sha':self.m.SOURCE,'tag':self.m.TAG,
               'archive_bytes':100,'archive_sha256':'a'*64,'image_metadata_sha256':'b'*64}
        receipt={**ready,'state':'IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED','runner_engine_version':'29.1.3',
                 'run_id':'39051472665','run_attempt':'1','ops_sha':'48bc5d648192f697bfca5965e009ed1af5af67b9'}
        self.m.admit_retirement_proof(ready,receipt,self.image)
        self.m.admit_retirement_proof(ready,receipt,{**self.image,'RepoDigests':['registry/private@sha256:'+'d'*64]})
        for changed in ({'ops_sha':'f'*40},{'run_id':'9999'},{'run_attempt':'2'},{'archive_sha256':'f'*64},
                        {'ops_sha':'2e41bc489f27b797e9f0d211d28ab97d347f4c50','run_id':'39050662769'}):
            with self.subTest(changed=changed),self.assertRaises(ValueError):
                self.m.admit_retirement_proof(ready,{**receipt,**changed},self.image)


@unittest.skipUnless(os.geteuid()==0,'Actual root ownership is required; mandatory on the isolated Actions runner')
class PrivilegedImageArchiveTests(unittest.TestCase):
    def setUp(self):
        import fcntl

        self.assertTrue(SCRIPT.is_file())
        spec=importlib.util.spec_from_file_location('privileged_image_archive',SCRIPT)
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.base=self.root/'archive';self.base.mkdir(mode=0o700)
        source=Path(os.environ['IMAGE_ARCHIVE_RECOVERY_SOURCE'])
        trusted=self.root/'release_recovery.py';shutil.copyfile(source,trusted);trusted.chmod(0o600)
        self.r=self.m.load_recovery(trusted)
        self.r.LOCK=self.root/'maintenance.lock'
        self.lock=self.r.LOCK.open('w');self.r.LOCK.chmod(0o600);self.addCleanup(self.lock.close)
        fcntl.flock(self.lock,fcntl.LOCK_EX)
        for key,value in {'STATE_DIR':self.root/'state','RUNTIME_DIR':self.root/'runtime',
                          'BACKUP_BASE':self.root/'backups'}.items():
            value.mkdir(mode=0o700);setattr(self.r,key,value)
        self.plan={'release_sha':self.m.ACCEPTED_SOURCE,'manifest_sha256':'d'*64,
                   'candidate_images':self.m.CURRENT_IMAGES,
                   'images':{role:'sha256:'+str(i+1)*64 for i,role in enumerate(self.m.CURRENT_IMAGES)},
                   'config_sha256':{'compose.json':'e'*64},'word':{'sha256':{'main':'f'*64}}}
        acceptance={'state':'RELEASE_CANDIDATE_ACCEPTED',**{key:self.plan[key] for key in (
            'release_sha','manifest_sha256','candidate_images','config_sha256')},'word_sha256':self.plan['word']['sha256']}
        self.marker={'plan_sha256':hashlib.sha256(json.dumps(self.plan,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                     'acceptance':acceptance}
        self.stage={'release_sha':self.m.PENDING_SOURCE,'images':self.m.CURRENT_IMAGES,
                    'candidate_images':{role:'sha256:'+str(i+5)*64 for i,role in enumerate(self.m.CURRENT_IMAGES)}}
        for path,value in [(self.r.RUNTIME_DIR/'trial-plan.json',self.plan),(self.r.RUNTIME_DIR/'stage.json',self.stage),
                           (self.r.STATE_DIR/'release-accepted.json',self.marker)]:self.r.atomic_json(path,value)
        self.image={'Id':self.m.IMAGE,'RepoTags':[self.m.TAG],
                    'Config':{'Labels':{'org.opencontainers.image.revision':self.m.SOURCE}},
                    'RootFS':{'Type':'layers','Layers':['sha256:'+'1'*64]},'Os':'linux','Architecture':'amd64'}
        self.containers=[{'Id':str(i+1)*64,'Name':'/aemr-'+role+'-1','Image':image,'RestartCount':0,
                          'Config':{'Labels':{'com.docker.compose.project':'aemr','com.docker.compose.service':role}},
                          'State':{'Status':'running','OOMKilled':False,'StartedAt':'2026-10-17T12:00:00Z',
                                   'Pid':i+1,'Health':{'Status':'healthy'}}}
                         for i,(role,image) in enumerate(self.m.CURRENT_IMAGES.items())]
        self.containers[0]['Mounts']=[{'Type':'volume','Source':'one','Destination':'/data','RW':True},
                                      {'Type':'bind','Source':'two','Destination':'/config','RW':False}]
        self.calls=[];self.inspections=0
        def command(args,**kwargs):
            self.calls.append(args)
            if args[:1]==['ps']:return '\n'.join(row['Id'] for row in self.containers)
            if args[:1]==['inspect']:
                self.inspections+=1;rows=json.loads(json.dumps(self.containers))
                if self.inspections%2==0:rows[0]['Mounts'].reverse()
                return json.dumps(rows)
            if args[:2]==['image','inspect']:return json.dumps([self.image])
            self.fail('Unexpected Docker mutation: '+str(args))
        self.command=command
        self.exports=0
        def export(path,lock_fd):
            self.r.require_lock(lock_fd);self.exports+=1;path.write_bytes(b'isolated immutable Docker export fixture'*1000)
        patcher=patch.object(self.m,'export_image',export);patcher.start();self.addCleanup(patcher.stop)

    def test_staged_candidate_reads_real_private_files_and_never_needs_the_retired_image(self):
        self.stage['format']='aemr-release-stage-v1'
        self.stage['candidate_images']=dict(self.m.STAGED_IMAGES)
        ci={'run':{'head_sha':self.m.PENDING_SOURCE,'name':'CI','event':'pull_request',
                   'path':'.github/workflows/ci.yml','head_repository':{'full_name':'gaben1488/dash'}},
            'jobs':[{'name':name,'status':'completed','conclusion':'success'} for name in (
                'Lint, TypeScript, Tests, Build, Audit','Report engine, publication and runtime',
                'Production image with report runtime')],
            'candidate_image_binding':{'source_sha':self.m.PENDING_SOURCE,'images':self.stage['candidate_images']}}
        self.r.atomic_json(self.r.RUNTIME_DIR/'source-ci.json',ci)
        self.stage['source_ci_sha256']=hashlib.sha256((self.r.RUNTIME_DIR/'source-ci.json').read_bytes()).hexdigest()
        self.stage['config_sha256']={}
        for name in self.r.CONFIG_FILES:
            body=b'private config '+name.encode();self.r.atomic_bytes(self.r.RUNTIME_DIR/name,body)
            self.stage['config_sha256'][name]=hashlib.sha256(body).hexdigest()
        self.r.atomic_json(self.r.RUNTIME_DIR/'stage.json',self.stage)
        gate=Path('/usr/local/libexec/aemr/source_ci_gate.py')
        original=self.r.read_owned
        def owned(path,**kwargs):
            if path==gate:return Path(__file__).with_name('source_ci_gate.py').read_bytes()
            return original(path,**kwargs)
        command0=self.command
        def command(args,**kwargs):
            if args[:2]==['image','inspect']:
                self.assertNotIn(self.m.IMAGE,args)
                return json.dumps([{'Id':identity,'Config':{'Labels':{'org.opencontainers.image.revision':self.m.PENDING_SOURCE}}}
                                   for identity in args[2:]])
            return command0(args,**kwargs)
        with patch.object(self.r,'read_owned',side_effect=owned):
            result=self.m.staged_candidates(self.r,command,self.lock.fileno())
            self.assertEqual(result['candidate_images'],self.m.STAGED_IMAGES)
            self.r.atomic_bytes(self.r.RUNTIME_DIR/'.env.production',b'changed')
            with self.assertRaisesRegex(ValueError,'CONFIG_CHANGED'):
                self.m.staged_candidates(self.r,command,self.lock.fileno())
        self.assertFalse((self.base/'ready.json').exists())
        self.assertFalse(any(call[:2]==['image','rm'] for call in self.calls))

    def test_prepare_is_reusable_and_receipt_is_durable_without_image_or_data_mutation(self):
        before=dict(self.containers[0])
        ready=self.m.prepare(self.r,self.command,self.base,self.lock.fileno())
        self.assertEqual(self.exports,1)
        self.assertEqual(self.m.prepare(self.r,self.command,self.base,self.lock.fileno()),ready)
        self.assertEqual(self.exports,1)
        self.assertEqual(self.containers[0],before)
        self.assertFalse((self.base/'image.tar.pending').exists())
        receipt={**ready,'state':'IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED','runner_engine_version':'29.1.3',
                 'run_id':'123','run_attempt':'1','ops_sha':'c'*40}
        self.m.save_receipt(self.r,self.base,receipt,self.lock.fileno())
        self.assertEqual(json.loads(self.r.read_owned(self.base/'roundtrip-123-1.json')),receipt)
        self.assertTrue((self.base/'image.tar.gz').is_file())
        self.assertNotIn('rm',[call[0] for call in self.calls])

    def test_pending_release_or_changed_marker_refuses_before_export(self):
        for path,value in [(self.r.STATE_DIR/'pending-release.json',{}),
                           (self.r.STATE_DIR/'release-accepted.json',{**self.marker,'plan_sha256':'f'*64})]:
            self.r.atomic_json(path,value)
            with self.assertRaises(ValueError):self.m.prepare(self.r,self.command,self.base,self.lock.fileno())
            self.assertEqual(self.exports,0)
            self.assertEqual(list(self.base.iterdir()),[])
            if path.name=='pending-release.json':path.unlink()

    def test_corrupt_saved_archive_is_never_reexported_or_receipted(self):
        ready=self.m.prepare(self.r,self.command,self.base,self.lock.fileno())
        (self.base/'image.tar.gz').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):self.m.prepare(self.r,self.command,self.base,self.lock.fileno())
        self.assertEqual(self.exports,1)
        receipt={**ready,'state':'IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED','runner_engine_version':'29.1.3',
                 'run_id':'123','run_attempt':'1','ops_sha':'c'*40}
        with self.assertRaises(ValueError):self.m.save_receipt(self.r,self.base,receipt,self.lock.fileno())
        self.assertFalse((self.base/'roundtrip-123-1.json').exists())

    def test_ready_archive_with_unexpected_large_scratch_is_refused(self):
        ready=self.m.prepare(self.r,self.command,self.base,self.lock.fileno())
        (self.base/'image.tar.pending').write_bytes(b'unexpected scratch')
        with self.assertRaisesRegex(ValueError,'PENDING_INSPECTION'):
            self.m.prepare(self.r,self.command,self.base,self.lock.fileno())
        receipt={**ready,'state':'IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED','runner_engine_version':'29.1.3',
                 'run_id':'123','run_attempt':'1','ops_sha':'c'*40}
        with self.assertRaisesRegex(ValueError,'PENDING_INSPECTION'):
            self.m.save_receipt(self.r,self.base,receipt,self.lock.fileno())

    def retirement_fixture(self):
        ready=self.m.prepare(self.r,self.command,self.base,self.lock.fileno())
        proof={**ready,'state':'IMAGE_ARCHIVE_ROUNDTRIP_VERIFIED','runner_engine_version':'29.1.3',
               'run_id':self.m.ROUNDTRIP_RUN,'run_attempt':'1','ops_sha':self.m.ROUNDTRIP_OPS}
        self.m.save_receipt(self.r,self.base,proof,self.lock.fileno())
        present={self.m.IMAGE,*self.m.CURRENT_IMAGES.values(),*self.plan['images'].values(),*self.stage['candidate_images'].values()}
        other={identity:{'Id':identity,'RepoTags':[], 'RepoDigests':[]} for identity in present if identity!=self.m.IMAGE}
        commands=[];original=self.command
        def command(args,**kwargs):
            commands.append(args)
            if args==['image','ls','--all','--quiet','--no-trunc']:return '\n'.join(sorted(present))
            if args[:2]==['image','inspect']:
                if any(identity not in present for identity in args[2:]):raise RuntimeError('isolated image absent')
                return json.dumps([self.image if identity==self.m.IMAGE else other[identity] for identity in args[2:]])
            if args==['image','rm','--no-prune',self.m.IMAGE]:present.remove(self.m.IMAGE);return 'removed'
            if args[:3]==['exec','aemr-server-1','/opt/report-env/bin/python']:
                return json.dumps(dict.fromkeys(('context','snapshot','main','supplement','operational'),'PASS'))
            return original(args,**kwargs)
        return ready,present,commands,command

    def test_retirement_removes_only_the_archived_image_and_keeps_all_recovery_material(self):
        self.image['RepoDigests']=['aemr-server@sha256:'+'d'*64]
        ready,present,calls,command=self.retirement_fixture()
        result=self.m.retire_image(self.r,command,self.base,self.lock.fileno())
        self.assertEqual(result['state'],'IMAGE_RETIRED_RECOVERABLY')
        self.assertNotIn(self.m.IMAGE,present)
        self.assertEqual([call for call in calls if call[:2]==['image','rm']],
                         [['image','rm','--no-prune',self.m.IMAGE]])
        self.assertEqual(result['archive_sha256'],ready['archive_sha256'])
        self.assertEqual(json.loads(self.r.read_owned(self.base/'retirement.json'))['state'],result['state'])
        self.m.checked_archive(self.r,self.base)
        self.assertTrue((self.base/('roundtrip-'+self.m.ROUNDTRIP_RUN+'-1.json')).exists())
        with self.assertRaisesRegex(ValueError,'RETIREMENT_ALREADY_RECORDED'):
            self.m.retire_image(self.r,command,self.base,self.lock.fileno())

    def test_missing_roundtrip_or_failed_native_smoke_never_removes_an_image(self):
        _,present,calls,command=self.retirement_fixture()
        proof=self.base/('roundtrip-'+self.m.ROUNDTRIP_RUN+'-1.json');saved=proof.read_bytes();proof.unlink()
        with self.assertRaises(FileNotFoundError):self.m.retire_image(self.r,command,self.base,self.lock.fileno())
        proof.write_bytes(saved);proof.chmod(0o600)
        def failed_smoke(args,**kwargs):
            if args[:1]==['exec']:return json.dumps({'context':'FAIL'})
            return command(args,**kwargs)
        with self.assertRaisesRegex(ValueError,'NATIVE_SMOKE_FAILED'):
            self.m.retire_image(self.r,failed_smoke,self.base,self.lock.fileno())
        self.assertIn(self.m.IMAGE,present)
        self.assertFalse(any(call[:2]==['image','rm'] for call in calls))
        self.assertFalse((self.base/'retirement.json').exists())

    def test_failed_docker_remove_preserves_the_archive_and_intention_without_blind_retry(self):
        _,present,calls,command=self.retirement_fixture()
        def refuse_remove(args,**kwargs):
            if args[:2]==['image','rm']:raise RuntimeError('isolated Docker conflict')
            return command(args,**kwargs)
        with self.assertRaises(RuntimeError):self.m.retire_image(self.r,refuse_remove,self.base,self.lock.fileno())
        self.assertIn(self.m.IMAGE,present)
        self.assertEqual(json.loads(self.r.read_owned(self.base/'retirement.json'))['state'],'IMAGE_RETIREMENT_INTENT')
        self.m.checked_archive(self.r,self.base)
        with self.assertRaisesRegex(ValueError,'RETIREMENT_ALREADY_RECORDED'):
            self.m.retire_image(self.r,command,self.base,self.lock.fileno())
        self.assertFalse(any(call[:2]==['image','rm'] for call in calls))


if __name__=='__main__':unittest.main()
