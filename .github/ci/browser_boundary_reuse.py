"""Reuse one accepted synthetic proof only when its complete inputs match."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

from source_ci_gate import source_ci_passed

BASELINE = 'b24a6a5dead4295f7bc61938a704554c8c9eef72'
BASELINE_RUN = 39125544933
STEP = 'Synthetic browser acceptance boundaries (no VPS or source data)'
DEPENDENCIES = (
    'packages/web', 'packages/shared', 'packages/core', 'scripts', 'patches',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'tsconfig.strict.json',
    '.github/ci/test_browser_auth_isolation.py', '.github/ci/test_browser_header_controls.py',
    '.github/ci/live_browser_readback.py', '.github/ci/source_ci_gate.py',
)


def can_reuse(run, jobs, baseline, candidate):
    if (not all(isinstance(value, dict) for value in (run, baseline, candidate))
            or not isinstance(jobs, list) or not all(isinstance(job, dict) for job in jobs)):
        return False
    expected = set(DEPENDENCIES) | {'workflow_scope'}
    if set(baseline) != expected or set(candidate) != expected or baseline != candidate:
        return False
    if not all(isinstance(value, str) and re.fullmatch('[a-f0-9]{64}' if key == 'workflow_scope'
                                                      else '[a-f0-9]{40}', value)
               for key, value in baseline.items()):
        return False
    if (run.get('id') != BASELINE_RUN or run.get('status') != 'completed'
            or run.get('conclusion') != 'success' or not source_ci_passed(run, jobs, BASELINE)):
        return False
    main = next(job for job in jobs if job['name'] == 'Lint, TypeScript, Tests, Build, Audit')
    steps = [step for step in main.get('steps', []) if step.get('name') == STEP]
    return len(steps) == 1 and steps[0].get('conclusion') == 'success'


def workflow_scope(source):
    start = source.index('    name: Lint, TypeScript, Tests, Build, Audit\n')
    marker = '      - name: ' + STEP + '\n'
    if source.count(marker) != 1:
        raise ValueError('BROWSER_STEP_NOT_UNIQUE')
    browser = source.index(marker)
    prefix = source[start:browser]
    decision = '      - name: Reuse accepted synthetic browser proof only for identical inputs\n'
    if decision in prefix:
        prefix = prefix[:prefix.index(decision)]
    section = source[browser:].split('\n      - name:', 1)[0]
    command = section.split('\n        run: |\n', 1)[1]
    # Keep the runner, setup/dependency steps, global environment and exact
    # browser commands in the proof. A changed gate never becomes a reused run.
    return hashlib.sha256((source.split('\njobs:\n', 1)[0] + prefix + command).encode()).hexdigest()


def inputs(ref):
    if not re.fullmatch('[a-f0-9]{40}', ref):
        raise ValueError('INVALID_SOURCE_SHA')
    result = {path: subprocess.check_output(['git', 'rev-parse', ref+':'+path], text=True).strip()
              for path in DEPENDENCIES}
    workflow = subprocess.check_output(['git', 'show', ref+':.github/workflows/ci.yml'], text=True)
    return result | {'workflow_scope': workflow_scope(workflow)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--jobs', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    reuse = False
    try:
        reuse = can_reuse(json.loads(Path(args.run).read_text()),
                          json.loads(Path(args.jobs).read_text())['jobs'], inputs(BASELINE), inputs(args.candidate))
    except (OSError, ValueError, KeyError, TypeError, IndexError, subprocess.CalledProcessError):
        pass  # Missing proof requires the complete check; it is never a PASS.
    with Path(args.output).open('a') as output:
        output.write('run_browser='+('false' if reuse else 'true')+'\n')
    print('SYNTHETIC_BROWSER_PROOF_REUSED '+BASELINE if reuse else 'SYNTHETIC_BROWSER_RUN_REQUIRED')


if __name__ == '__main__':
    main()
