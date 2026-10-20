"""Read-only TS/Python economy comparison on one verified frozen source bundle.

Run with the report Python environment and installed Node/tsx dependencies.
Only aggregates are printed. This proves the selected annual context, not all
filters, identities, current Google data, or readiness to switch live consumers.
"""
import argparse
import json
import os
import subprocess
import sys
from decimal import Decimal
from pathlib import Path


def compare(bundle, repo):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(repo / 'packages/report-engine/src'))
    from procurement_engine.adapters import normalize_master_values
    from procurement_engine.canonical_metrics import metric_block
    from procurement_engine.normalize import parse_date
    from procurement_engine.snapshot_bundle_io import verify_persisted_bundle

    if verify_persisted_bundle(bundle):
        raise ValueError('SOURCE_BUNDLE_INVALID')
    manifest = json.loads((bundle / 'manifest.json').read_text())
    inputs, expected = [], []
    for entry in manifest['payload_index']:
        payload = json.loads((bundle / entry['path']).read_text())
        if payload['role'] != 'master':
            continue
        metadata, values = payload['metadata'], payload['semantic_values']
        rows = normalize_master_values(values, snapshot_id=manifest['snapshot_id'],
            expected_grbs=metadata['grbs'], data_start_row=metadata['header_rows'],
            source_id=payload['source_id'])
        result = metric_block(rows, report_year=manifest['report_year'], as_of=manifest['report_date'])
        expected.append({'source': payload['source_id'], 'python_count': result['plan_count'],
            'python_economy': result['exact_decimal']['confirmed_saving_amount']})
        inputs.append({'source': payload['source_id'], 'values': values, 'headers': metadata['header_rows']})
    wanted = {source['source_id'] for source in manifest['sources'] if source['role'] == 'master'}
    if not wanted or len(expected) != len(wanted) or {r['source'] for r in expected} != wanted:
        raise ValueError('MASTER_SET_INCOMPLETE')
    code = """
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const {CalcEngine,standardRowFilter,getValue}=await import(pathToFileURL(input.repo+'/packages/core/src/pipeline/calc-engine.ts').href);
const {dayNumberOf}=await import(pathToFileURL(input.repo+'/packages/shared/src/parse-sheet-date.ts').href);
console.log(JSON.stringify(input.sources.map(s=>{
  const r=new CalcEngine().compute(s.values,standardRowFilter,s.headers,input.year,{asOfDay:dayNumberOf(input.asOf)});
  return {source:s.source,ts_count:getValue(r,'plan_count'),ts_economy:getValue(r,'economy_total')};
})));
"""
    as_of = parse_date(manifest['report_date'])
    process = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', code],
        input=json.dumps({'sources': inputs, 'year': manifest['report_year'], 'asOf': as_of, 'repo': str(repo.resolve())}),
        text=True, capture_output=True, timeout=60, cwd=repo / 'packages/server', env={**os.environ, 'TSX_DISABLE_CACHE': '1'})
    if process.returncode:
        raise ValueError('TS_COMPARISON_FAILED')
    actual = json.loads(process.stdout)
    if len(actual) != len(expected):
        raise ValueError('TS_MASTER_SET_MISMATCH')
    results = []
    for left, right in zip(expected, actual):
        if left['source'] != right['source']:
            raise ValueError('TS_MASTER_SET_MISMATCH')
        delta = abs(Decimal(left['python_economy']) - Decimal(str(right['ts_economy'])))
        # Inputs are thousands of RUB. Tolerance is 0.000001 RUB, well below
        # one kopeck, and only accommodates binary floating-point summation.
        passed = delta.is_finite() and delta <= Decimal('0.000000001') and left['python_count'] == right['ts_count']
        results.append({**left, **right, 'absolute_error_thousand': str(delta), 'passed': passed})
    return {'state': 'PASS' if all(r['passed'] for r in results) else 'MISMATCH',
        'snapshot_id': manifest['snapshot_id'], 'report_year': manifest['report_year'],
        'as_of': as_of, 'results': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--repo', type=Path, required=True)
    args = parser.parse_args()
    try:
        evidence = compare(args.bundle, args.repo)
    except Exception as error:
        # Provider values, paths and subprocess stderr must not escape through errors.
        allowed = {'SOURCE_BUNDLE_INVALID', 'MASTER_SET_INCOMPLETE', 'TS_COMPARISON_FAILED', 'TS_MASTER_SET_MISMATCH'}
        print(json.dumps({'state': 'PROBE_FAILED', 'error_type': type(error).__name__,
            'code': str(error) if str(error) in allowed else 'INVALID_INPUT_OR_RUNTIME'}))
        raise SystemExit(2)
    print(json.dumps(evidence, ensure_ascii=False, allow_nan=False))
    raise SystemExit(0 if evidence['state'] == 'PASS' else 2)
