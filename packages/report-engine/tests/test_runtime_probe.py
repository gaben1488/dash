import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_probe_formula_summary_exposes_only_fixed_codes_and_numeric_geometry():
    script = (ROOT / '.github/workflows/report-runtime-probe.yml').read_text()
    start = script.index('            def formula_summary(')
    end = script.index('            # End formula summary', start)
    code = '\n'.join(line[12:] for line in script[start:end].splitlines())
    namespace = {}
    exec(code, namespace)  # noqa: S102 — execute only the checked-in workflow function under test.
    model = {'formula_dependencies': {'closed': False, 'issues': [
        {'code': 'FORMULA_DEPENDENCY_RANGE_NOT_CAPTURED', 'source_id': 'private-master',
         'target_source_id': 'private-support', 'row': 4, 'column': 6},
        {'code': 'SECRET_VALUE', 'source_id': 'private-master', 'functions': ['secret-token']}]}}
    payloads = [{'source_id': 'private-master', 'role': 'historical_control_dependency',
                 'metadata': {'formula_evidence': {'rows': 10, 'columns': 26}}},
                {'source_id': 'private-support', 'role': 'historical_control_dependency',
                 'metadata': {'formula_evidence': {'rows': 9, 'columns': 23}}}]
    summary = namespace['formula_summary'](model, payloads)
    encoded = json.dumps(summary)
    assert summary['issue_counts'] == {'FORMULA_DEPENDENCY_RANGE_NOT_CAPTURED': 1, 'UNRECOGNIZED_ERROR': 1}
    assert summary['range_geometry'][0] == {'source_rows': 10, 'source_columns': 26,
                                           'target_rows': 9, 'target_columns': 23}
    assert all(value not in encoded for value in ('private-master', 'private-support', 'secret-token', 'SECRET_VALUE'))
