"""Read-only browser admission must not pass an unopened maintenance descriptor."""
import ast
import importlib.util
import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('browser_release_recovery',ROOT/'deploy/release_recovery.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class BrowserAdmissionTests(unittest.TestCase):
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
    def test_only_explicit_owner_browser_request_can_run_on_push(self):
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        section=workflow.split('  browser-readback:\n',1)[1].split('  observe:\n',1)[0]
        expression=' '.join(section.split('if: >-\n',1)[1].split('runs-on:',1)[0].split()).replace('&&','and').replace('||','or')
        marker='Verify real browser for accepted 43f10742'
        for name,event,actor,branch,message,mode,sha,expected in (
            ('explicit-push','push','owner','codex/release-observe-20261015',marker,'','',True),
            ('ordinary-push','push','owner','codex/release-observe-20261015','other','','',False),
            ('foreign-push','push','someone','codex/release-observe-20261015',marker,'','',False),
            ('main-push','push','owner','main',marker,'','',False),
            ('browser-dispatch','workflow_dispatch','owner','codex/release-observe-20261015','', 'browser','43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa',True),
            ('metadata-dispatch','workflow_dispatch','owner','codex/release-observe-20261015','', 'metadata','43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa',False)):
            with self.subTest(name=name):
                context={'github':SimpleNamespace(event_name=event,actor=actor,repository_owner='owner',ref='refs/heads/'+branch,event=SimpleNamespace(head_commit=SimpleNamespace(message=message))), 'inputs':SimpleNamespace(mode=mode,release_sha=sha)}
                result=eval(expression,{'__builtins__':{}},context)  # Evaluate only the checked-in fixed Actions condition.
                self.assertEqual(bool(result),expected)



if __name__=='__main__':unittest.main()
