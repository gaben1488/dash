"""Exercise the exact-candidate probe with synthetic private payloads only."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ReportSchemaProbeTests(unittest.TestCase):
    def test_selection_shape_preserves_exact_and_fallback_distinction_without_ids(self):
        first = {'release_id': 'REL-' + 'a' * 64, 'private': 'PRIVATE_SYNTHETIC_VALUE_DO_NOT_LOG'}
        other = dict(first, release_id='REL-' + 'b' * 64)
        cases = [({'selected': first, 'latest_matching': first}, [True, True, True]),
                 ({'selected': first, 'latest_matching': other}, [True, True, False]),
                 ({'selected': None, 'latest_matching': other}, [False, True, None]),
                 ({'selected': first}, [True, False, None])]
        result = subprocess.run(['node', '-e',
            ("const p=require('./.github/ci/report-schema-probe.cjs');"
            "const x=JSON.parse(require('node:fs').readFileSync(0,'utf8'));"
            "console.log(JSON.stringify(x.map(p.selectionShape)));")], cwd=ROOT,
            input=json.dumps([value for value, _ in cases]), text=True, capture_output=True,
            timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = [dict(zip(('selected_present', 'latest_matching_present', 'same_release'), flags, strict=True))
                    for _, flags in cases]
        self.assertEqual(json.loads(result.stdout), expected)
        self.assertNotIn(first['private'], result.stdout)
        self.assertNotIn(first['release_id'], result.stdout)

    def test_full_probe_checks_history_and_current_http_without_logging_payloads(self):
        assurance = {'contract': 'actionable-assurance-v2', 'fully_automated': False,
                     'user_action_count': 0, 'engine_action_count': 0, 'active_recommendations': 159,
                     'link_status_counts': {}, 'action_status_counts': {}, 'actions': [],
                     'source_observations': [], 'nonprocurement_identity_observations': 0,
                     'meaning': 'PRIVATE_SYNTHETIC_VALUE_DO_NOT_LOG'}
        receipt = {'release_id': 'REL-' + 'a' * 64, 'snapshot_id': 'synthetic-snapshot',
                   'report_date': '12.10.2026', 'cutoff_at': '2026-10-11T22:00:00Z',
                   'published_at': '2026-10-11T22:01:00Z', 'model_sha256': 'b' * 64,
                   'rules_version': 'synthetic', 'renderer_version': 'synthetic', 'status': 'VERIFIED',
                   'report_year': 2026, 'quarter': 4, 'automation_assurance': assurance}
        envelope = {name: (ROOT / source).read_text() for name, source in (
            ('schemas', 'packages/shared/src/schemas.ts'),
            ('registry', 'packages/shared/src/department-registry.ts'),
            ('coverage', 'packages/shared/src/source-coverage.ts'))}
        envelope['directory'] = json.loads((ROOT / 'packages/report-engine/src/procurement_engine/department_directory.json').read_text())
        program = """const fs=require('node:fs'),path=require('node:path');
const originalRead=fs.readFileSync, originalDir=fs.readdirSync, originalStat=fs.lstatSync;
const input=JSON.parse(originalRead(0,'utf8'));
const map=p=>typeof p==='string'&&p.startsWith('/app/packages/server/data/reports')
?p.replace('/app/packages/server/data/reports',input.root):p;
fs.readFileSync=(p,...args)=>p===0?JSON.stringify(input):originalRead(map(p),...args);
fs.readdirSync=(p,...args)=>originalDir(map(p),...args);
fs.lstatSync=(p,...args)=>originalStat(map(p),...args);
const {createRequire}=require('node:module'); const originalCreate=createRequire;
require('node:module').createRequire=p=>originalCreate(p==='/app/packages/shared/package.json'
?path.resolve('packages/shared/package.json'):p);
global.fetch=async()=>({status:200,json:async()=>input.response});
require('./.github/ci/report-schema-probe.cjs').main().catch(()=>process.exitCode=3);"""
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'published/releases/REL-synthetic'
            folder.mkdir(parents=True)
            (Path(tmp) / 'archives').mkdir()
            envelope.update(root=tmp, response={'selected': receipt, 'attempt': None})
            for source, current, accepted in [(assurance, receipt, True),
                    (dict(assurance, source_observations=None), receipt, False),
                    (assurance, dict(receipt, automation_assurance=dict(assurance, contract='actionable-assurance-v3')), False)]:
                (folder / 'report_model.json').write_text(json.dumps({'automation_assurance': source}))
                envelope['response']['selected'] = current
                result = subprocess.run(['node', '-e', program], cwd=ROOT, input=json.dumps(envelope),
                                        text=True, capture_output=True, timeout=15, check=False)
                self.assertEqual(result.returncode, 0 if accepted else 2, result.stderr)
                self.assertEqual(json.loads(result.stdout)['candidate_schema_history'], 'PASS' if accepted else 'FAIL')
                self.assertNotIn(assurance['meaning'], result.stdout)

    def test_candidate_schema_preserves_historical_versions_and_fails_closed(self):
        common = {'fully_automated': False, 'user_action_count': 0, 'engine_action_count': 1,
                  'active_recommendations': 159, 'link_status_counts': {}, 'action_status_counts': {},
                  'actions': [], 'meaning': 'PRIVATE_SYNTHETIC_VALUE_DO_NOT_LOG'}
        v1 = dict(common, contract='actionable-assurance-v1')
        v2 = dict(common, contract='actionable-assurance-v2', source_observations=[],
                  nonprocurement_identity_observations=0)
        cases = [(None, True), (v1, True), (v2, True),
                 (dict(v2, contract='actionable-assurance-v3'), False),
                 (dict(v2, user_action_count=-1), False),
                 ({k: v for k, v in v2.items() if k != 'source_observations'}, False)]
        envelope = {name: (ROOT / path).read_text() for name, path in (
            ('schemas', 'packages/shared/src/schemas.ts'),
            ('registry', 'packages/shared/src/department-registry.ts'),
            ('coverage', 'packages/shared/src/source-coverage.ts'))}
        envelope['directory'] = json.loads((ROOT / 'packages/report-engine/src/procurement_engine/department_directory.json').read_text())
        for assurance, accepted in cases:
            with self.subTest(assurance_version=assurance and assurance['contract'], accepted=accepted):
                result = subprocess.run(['node', '-e',
                    ("const p=require('./.github/ci/report-schema-probe.cjs');"
                    "const x=JSON.parse(require('node:fs').readFileSync(0,'utf8'));"
                    "const s=p.loadCandidate(x,require('node:path').resolve('packages/shared/package.json'));"
                    "console.log(JSON.stringify(p.checkAssurance(s.ReportAssuranceSchema,x.assurance)));")],
                    cwd=ROOT, input=json.dumps(envelope if assurance is None else dict(envelope, assurance=assurance)),
                    text=True, capture_output=True, timeout=15, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)['accepted'], accepted)
                self.assertNotIn(common['meaning'], result.stdout)


if __name__ == '__main__':
    unittest.main()
