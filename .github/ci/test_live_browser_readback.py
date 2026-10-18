"""Read-only browser admission must not pass an unopened maintenance descriptor."""
import ast
import importlib.util
import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import ClassVar
from unittest import mock

from test_acceptance_target_binding import TARGET

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('browser_release_recovery',ROOT/'deploy/release_recovery.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class BrowserAdmissionTests(unittest.TestCase):
    def test_image_inventory_does_not_expose_config_or_arbitrary_tags(self):
        import contextlib
        import io
        import json
        import re
        import textwrap
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        self.assertIn('            def image_storage_metadata():',workflow)
        body=workflow.split('            def image_storage_metadata():',1)[1].split('\n            def ',1)[0]
        ident='sha256:'+'a'*64
        record={'Id':ident,'Size':123456,'RepoTags':['aemr-server:PRIVATE_TAG'],
            'Config':{'Env':['PRIVATE_KEY=PRIVATE_SECRET'],'Labels':{'org.opencontainers.image.revision':'PRIVATE_SOURCE'}}}
        calls=[]
        def command(arguments,**kwargs):
            calls.append(arguments)
            return ident+'\n' if len(calls)==1 else json.dumps([record])
        scope={'subprocess':SimpleNamespace(check_output=command),'json':json,'re':re}
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            program='def probe():\n'+textwrap.indent(textwrap.dedent(body),'    ')+'\nprobe()'
            exec(compile(program,'<image-inventory>','exec'),scope)  # noqa: S102 - trusted read-only workflow
        self.assertEqual(json.loads(output.getvalue()),{'image':ident,'image_bytes':123456,'source_sha':None,'project_image':True,'tagged':True})
        self.assertNotIn('PRIVATE',output.getvalue())
        self.assertEqual(calls,[['docker','image','ls','--all','--no-trunc','--quiet'],['docker','image','inspect',ident]])
        record['RepoTags']=None
        record['Config']['Labels']['org.opencontainers.image.revision']='f'*40
        calls.clear();output=io.StringIO()
        with contextlib.redirect_stdout(output):exec(compile(program,'<image-inventory>','exec'),scope)  # noqa: S102 - trusted read-only workflow
        self.assertEqual(json.loads(output.getvalue()),{'image':ident,'image_bytes':123456,'source_sha':None,'project_image':False,'tagged':False})

    def test_host_capacity_inventory_projects_counts_without_private_paths(self):
        import contextlib
        import io
        import json
        import textwrap
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        self.assertIn('            def host_storage_metadata():',workflow)
        body=workflow.split('            def host_storage_metadata():',1)[1].split('\n            def ',1)[0]
        calls=[]
        def command(arguments,**kwargs):
            calls.append(arguments)
            return SimpleNamespace(returncode=0,stdout=b'123456\tPRIVATE_PATH\n')
        scope={'subprocess':SimpleNamespace(run=command),'json':json}
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(compile(textwrap.dedent(body),'<storage-inventory>','exec'),scope)  # noqa: S102 - trusted checked-in read-only function
        rows=[json.loads(line) for line in output.getvalue().splitlines()]
        self.assertGreater(len(rows),3)
        self.assertTrue(all(row['allocated_bytes']==123456 for row in rows))
        self.assertNotIn('PRIVATE',output.getvalue())
        self.assertTrue(all(args[:3]==['du','-s','--block-size=1'] for args in calls))
        self.assertTrue(all(row['category'].replace('_','').isalpha() for row in rows))

    def test_response_evidence_never_copies_url_body_or_credentials(self):
        source=ast.parse((ROOT/'.github/ci/live_browser_readback.py').read_text())
        function=next(node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='record_response')
        from urllib.parse import urlsplit
        scope={'urlsplit':urlsplit,'BASE':'https://dash-elizovo-uer.ru'}
        exec(compile(ast.Module(body=[function],type_ignores=[]),'<response-probe>','exec'),scope)  # noqa: S102 - trusted checked-in probe only
        proof={}
        for status in (401,200):
            scope['record_response'](SimpleNamespace(url='https://dash-elizovo-uer.ru/api/dashboard?private=do-not-copy',status=status),proof)
        scope['record_response'](SimpleNamespace(url='https://external.invalid/api/dashboard',status=418),proof)
        scope['record_response'](SimpleNamespace(url='https://dash-elizovo-uer.ru/api/unknown',status=500),proof)
        self.assertEqual(proof,{'dashboard_http_statuses':[401,200]})
        scope['record_response'](SimpleNamespace(url='https://dash-elizovo-uer.ru/api/report-releases/REL-synthetic/main.docx',status=200),proof)
        self.assertEqual(proof['word_http_statuses'], [200])
        for _ in range(100):
            scope['record_response'](SimpleNamespace(url='https://dash-elizovo-uer.ru/api/dashboard',status=500),proof)
        self.assertEqual(len(proof['dashboard_http_statuses']),8)

    def test_actual_workflow_constructor_runs_with_no_maintenance_fd(self):
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        section=workflow.split('  browser-readback:\n',1)[1].split('  observe:\n',1)[0]
        line=next(line.strip() for line in section.splitlines() if 'executor=r.ReleaseRecovery(' in line)
        assignment=ast.parse(line.split(';',1)[0])
        context={'r':module};exec(compile(assignment,'<browser-workflow>','exec'),context)  # noqa: S102 - execute only the trusted workflow constructor
        original=subprocess.run
        def native_probe(arguments,**kwargs):
            return original([sys.executable,'-IB','-c','print("{}")'],**kwargs)
        saved=None
        try:
            try:saved=os.dup(9);os.close(9)
            except OSError:pass
            with mock.patch.object(module.subprocess,'run',side_effect=native_probe):
                self.assertEqual(context['executor'].command(['inspect','synthetic']), '{}\n')
        finally:
            if saved is not None:os.dup2(saved,9);os.close(saved)
    def test_failed_worker_details_expose_only_fixed_codes_and_sections(self):
        import textwrap
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        source=workflow.split('            def worker_operational_metadata(include_saved=True):',1)[1].split('            def weekly_stage_failure_metadata():',1)[0]
        tree=ast.parse(textwrap.dedent('            def worker_operational_metadata(include_saved=True):'+source))
        function=next(node for node in tree.body[0].body if isinstance(node,ast.FunctionDef) and node.name=='failure_details')
        scope={'codes':{'FORMULA_DEPENDENCY_NOT_CAPTURED','DUPLICATE_PROCEDURE_CODE'}}
        exec(compile(ast.Module(body=[function],type_ignores=[]),'<failure-details>','exec'),scope)  # noqa: S102 - trusted checked-in projector only
        value={'formula_dependencies':{'closed':False,'issues':[{'code':'FORMULA_DEPENDENCY_NOT_CAPTURED','formula':'private'}]},'issues':[{'severity':'ERROR','code':'DUPLICATE_PROCEDURE_CODE','message':'private'},{'severity':'ERROR','code':'secret'},{'severity':'WARNING','code':'DUPLICATE_PROCEDURE_CODE'}]}
        result=scope['failure_details'](value)
        self.assertEqual(result,{'formula_closed':False,'formula_issue_counts':{'FORMULA_DEPENDENCY_NOT_CAPTURED':1},'source_error_counts':{'DUPLICATE_PROCEDURE_CODE':1,'OTHER':1}})
        queue=scope['failure_details']({'issues':[{'severity':'ERROR','code':'PROCEDURE_QUEUE_COVERAGE_MISMATCH','context':{'block':'active','missing':['private-code-1','private-code-2'],'unexpected':['private-code-3']}}]})
        self.assertEqual(queue,{'source_error_counts':{'OTHER':1},'queue_coverage':[{'block':'active','missing_count':2,'unexpected_count':1}]})
        location=scope['failure_details']({'formula_dependencies':{'issues':[{'code':'FORMULA_DEPENDENCY_NOT_CAPTURED','source_id':'PROCEDURES_2526300','row':460,'column':25,'target_sheet_id':'unknown:REF','formula':'private'}]}})
        self.assertEqual(location,{'formula_issue_counts':{'FORMULA_DEPENDENCY_NOT_CAPTURED':1},'formula_issue_locations':[{'source':'PROCEDURES_2526300','row':460,'column':25,'target_kind':'INVALID_REFERENCE'}]})

    def test_absent_saved_files_cannot_inherit_previous_projection(self):
        import json
        import re
        import stat
        import tempfile
        import textwrap
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        source=workflow.split('            def worker_operational_metadata(include_saved=True):',1)[1].split('            def weekly_stage_failure_metadata():',1)[0]
        for existing in (True,False):
            with self.subTest(existing=existing),tempfile.TemporaryDirectory() as temporary:
                first=Path(temporary)/'status.json';missing=Path(temporary)/'missing.json'
                if existing:
                    first.write_text(json.dumps({'blockers':[{'code':'SECTION_SOURCE_MISMATCH','context':{'sections':['procedure_source_contract']}}]}));first.chmod(0o600)
                function=ast.parse(textwrap.dedent('            def worker_operational_metadata(include_saved=True):'+source)).body[0]
                function.body=[node for node in function.body if isinstance(node,ast.FunctionDef) or (isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='codes' for target in node.targets)) or (isinstance(node,ast.For) and isinstance(node.target,ast.Name) and node.target.id=='path')]
                loop=next(node for node in function.body if isinstance(node,ast.For))
                loop.iter=ast.parse('[Path('+repr(str(first))+'),Path('+repr(str(missing))+')]',mode='eval').body
                output=[];scope={'Path':Path,'os':os,'json':json,'re':re,'stat':stat,'print':lambda line,output=output,**kwargs:output.append(json.loads(line))}
                exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),'<actual-worker-reader>','exec'),scope)  # noqa: S102 - trusted checked-in bounded read loop
                scope['worker_operational_metadata']()
                self.assertEqual(len(output),2)
                self.assertFalse(output[1]['present'])
                self.assertNotIn('section_error_counts',output[1])
                if existing:self.assertEqual(output[0]['section_error_counts'],{'procedure_source_contract':1})

    def test_native_timing_streams_payload_without_logging_body_or_token(self):
        import contextlib
        import hashlib
        import io
        import json
        import urllib.request
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        section=workflow.split('  api-timing:\n',1)[1].split('  worker-observe:\n',1)[0]
        line=next(line.strip() for line in section.splitlines() if line.strip().startswith('code='))
        program=ast.literal_eval(ast.parse(line).body[0].value)
        body=b'{"private":"synthetic-body-must-not-appear"}'+b' '*200000
        class Response:
            status=200
            headers: ClassVar[dict[str,str]]={'x-aemr-data-state':'refreshing', 'x-aemr-data-captured-at':'2026-10-16T15:00:00.000Z'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,size):
                self_test.assertLessEqual(size,65536)
                part=self.remaining[:size];self.remaining=self.remaining[size:];return part
        self_test=self
        def open_response(*args,**kwargs):
            response=Response();response.remaining=body;return response
        output=io.StringIO()
        with mock.patch.object(urllib.request,'urlopen',side_effect=open_response),mock.patch.dict(os.environ,{'AEMR_API_KEY':'synthetic-secret-never-print'}),mock.patch.object(sys,'argv',['native-probe','journal']),contextlib.redirect_stdout(output):
            exec(compile(program,'<actual-native-timing>','exec'),{})  # noqa: S102 - trusted checked-in streaming diagnostic
        rows=[json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(rows),2)
        for row in rows:
            self.assertEqual(row['bytes'],len(body));self.assertEqual(row['response_sha256'],hashlib.sha256(body).hexdigest())
            self.assertEqual(row['endpoint'],'journal')
            self.assertEqual(row['data_state'], 'refreshing')
            self.assertEqual(row['captured_at'], '2026-10-16T15:00:00.000Z')
        self.assertNotIn('synthetic-body',output.getvalue());self.assertNotIn('synthetic-secret',output.getvalue())

    def test_readonly_worker_and_profile_pushes_are_explicit_and_owner_scoped(self):
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        for job,marker,sha in [('worker-observe',f'Observe controlled release worker for accepted {TARGET[:8]}',TARGET),('api-timing',f'Profile journal read for accepted {TARGET[:8]}',TARGET)]:
            section=workflow.split('  '+job+':\n',1)[1]
            expression=' '.join(section.split('if: >-\n',1)[1].split('runs-on:',1)[0].split()).replace('&&','and').replace('||','or')
            for event,actor,branch,message,mode,expected in [('push','owner','codex/release-observe-20261015',marker,'',True),('push','other','codex/release-observe-20261015',marker,'',False),('push','owner','main',marker,'',False),('push','owner','codex/release-observe-20261015','other','',False),('workflow_dispatch','owner','codex/release-observe-20261015','',job,True)]:
                with self.subTest(job=job,event=event,actor=actor,branch=branch,message=message):
                    context={'github':SimpleNamespace(event_name=event,actor=actor,repository_owner='owner',ref='refs/heads/'+branch,event=SimpleNamespace(head_commit=SimpleNamespace(message=message))),'inputs':SimpleNamespace(mode=mode,release_sha=sha)}
                    self.assertEqual(bool(eval(expression,{'__builtins__':{}},context)),expected)
            if job in {'worker-observe','api-timing'}:
                context['inputs'].release_sha='83b813ab250b4533d1b80ba9e306afaa8bc5f383'
                self.assertFalse(bool(eval(expression,{'__builtins__':{}},context)))
                context['github'].event_name='push'
                context['github'].event.head_commit.message=('Observe controlled release worker for accepted 83b813ab' if job=='worker-observe' else 'Profile journal read for accepted 83b813ab')
                self.assertFalse(bool(eval(expression,{'__builtins__':{}},context)))
                context['github'].event_name='workflow_dispatch'
            if job in {'worker-observe','api-timing'}:
                context['inputs'].release_sha='43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa'
                self.assertFalse(bool(eval(expression,{'__builtins__':{}},context)))
                context['github'].event_name='push'
                context['github'].event.head_commit.message=('Observe repaired source worker for accepted 43f10742' if job=='worker-observe' else 'Profile dashboard read for accepted 43f10742')
                self.assertFalse(bool(eval(expression,{'__builtins__':{}},context)))

    def test_saved_worker_probe_is_readonly_and_owner_scoped(self):
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        section=workflow.split('  observe:\n',1)[1].split('  proof-recovery:\n',1)[0]
        expression=' '.join(section.split('if: >-\n',1)[1].split('runs-on:',1)[0].split()).replace('&&','and').replace('||','or')
        marker='Inspect saved worker refusal for accepted 43f10742'
        for event,actor,message,expected in [('push','owner',marker,True),('push','someone',marker,False),('push','owner','other',False),('workflow_dispatch','owner','',True)]:
            with self.subTest(event=event,actor=actor,message=message):
                context={'github':SimpleNamespace(event_name=event,actor=actor,repository_owner='owner',ref='refs/heads/codex/release-observe-20261015',event=SimpleNamespace(head_commit=SimpleNamespace(message=message))),'inputs':SimpleNamespace(mode='metadata',release_sha=TARGET)}
                self.assertEqual(bool(eval(expression,{'__builtins__':{}},context)),expected)

    def test_explicit_phone_push_can_use_the_same_headed_engine_as_accepted_baseline(self):
        workflow = (ROOT/'.github/workflows/ci.yml').read_text()
        expression = workflow.split('      BROWSER_HEADED: ${{', 1)[1].split('}}', 1)[0].strip()
        expression = expression.replace('&&', 'and').replace('||', 'or')
        for event, message, renderer, expected in (
            ('push', f'Verify iPhone browser for accepted {TARGET[:8]} headed', '', '1'),
            ('push', f'Verify iPhone browser for accepted {TARGET[:8]}', '', '0'),
            ('push', 'arbitrary headed text', '', '0'),
            ('workflow_dispatch', '', 'headed', '1'),
            ('workflow_dispatch', '', 'headless', '0')):
            scope = {'github': SimpleNamespace(event_name=event, event=SimpleNamespace(head_commit=SimpleNamespace(message=message))),
                     'inputs': SimpleNamespace(browser_renderer=renderer)}
            self.assertEqual(eval(expression, {'__builtins__': {}}, scope), expected)

    def test_only_explicit_owner_browser_request_can_run_on_push(self):
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        section=workflow.split('  browser-readback:\n',1)[1].split('  observe:\n',1)[0]
        expression=' '.join(section.split('if: >-\n',1)[1].split('runs-on:',1)[0].split()).replace('&&','and').replace('||','or')
        marker=f'Verify real browser for accepted {TARGET[:8]}'
        for name,event,actor,branch,message,mode,sha,expected in (
            ('explicit-push','push','owner','codex/release-observe-20261015',marker,'','',True),
            ('iphone-body','push','owner','codex/release-observe-20261015',f'Verify iPhone browser for accepted {TARGET[:8]}\n\nReviewed touch fixture.','','',True),
            ('foreign-iphone','push','someone','codex/release-observe-20261015',f'Verify iPhone browser for accepted {TARGET[:8]}','','',False),
            ('previous192-push','push','owner','codex/release-observe-20261015','Verify real browser for accepted 19289667','','',False),
            ('previous192-dispatch','workflow_dispatch','owner','codex/release-observe-20261015','', 'browser','19289667b0aca6f88ff6225c9a3a8c849a592c9d',False),
            ('old-push','push','owner','codex/release-observe-20261015','Verify real browser for accepted 43f10742','','',False),
            ('old-dispatch','workflow_dispatch','owner','codex/release-observe-20261015','', 'browser','43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa',False),
            ('prior83-push','push','owner','codex/release-observe-20261015','Verify real browser for accepted 83b813ab','','',False),
            ('prior83-dispatch','workflow_dispatch','owner','codex/release-observe-20261015','', 'browser','83b813ab250b4533d1b80ba9e306afaa8bc5f383',False),
            ('ordinary-push','push','owner','codex/release-observe-20261015','other','','',False),
            ('foreign-push','push','someone','codex/release-observe-20261015',marker,'','',False),
            ('main-push','push','owner','main',marker,'','',False),
            ('browser-dispatch','workflow_dispatch','owner','codex/release-observe-20261015','', 'browser',TARGET,True),
            ('metadata-dispatch','workflow_dispatch','owner','codex/release-observe-20261015','', 'metadata',TARGET,False)):
            with self.subTest(name=name):
                context={'github':SimpleNamespace(event_name=event,actor=actor,repository_owner='owner',ref='refs/heads/'+branch,event=SimpleNamespace(head_commit=SimpleNamespace(message=message))), 'inputs':SimpleNamespace(mode=mode,release_sha=sha)}
                context['startsWith'] = lambda value, prefix: value.lower().startswith(prefix.lower())
                result=eval(expression,{'__builtins__':{}},context)  # Evaluate only the checked-in fixed Actions condition.
                self.assertEqual(bool(result),expected)



if __name__=='__main__':unittest.main()
