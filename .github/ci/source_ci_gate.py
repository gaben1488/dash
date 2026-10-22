"""Exact source-job proof for maintenance admission; never a deployment/live proof."""
import json
import re
import sys

REQUIRED = {'Lint, TypeScript, Tests, Build, Audit',
            'Report engine, publication and runtime', 'Production image with report runtime'}


def source_ci_passed(run, jobs, sha):
    # Historical PR79 admission is unchanged. Main release requests additionally
    # require owner-attributed push and successful source-diagnostics CI.
    # Deployment also checks a one-file, parent-pinned release intent.
    owner_integrated_push = (
        run.get('event') == 'push'
        and run.get('head_branch') == 'codex/dash-audit-integrated-20261010'
        and (run.get('actor') or {}).get('login') == 'gaben1488'
    )
    owner_main_push = (
        run.get('event') == 'push'
        and run.get('head_branch') == 'main'
        and (run.get('actor') or {}).get('login') == 'gaben1488'
    )
    if (not re.fullmatch('[a-f0-9]{40}', sha) or run.get('head_sha') != sha
            or run.get('name') != 'CI'
            or not (run.get('event') == 'pull_request' or owner_integrated_push or owner_main_push)
            or run.get('path') != '.github/workflows/ci.yml'
            or (run.get('head_repository') or {}).get('full_name') != 'gaben1488/dash'):
        return False
    required_names = REQUIRED | {'Source diagnostics API/UI contract and KB regressions'} if owner_main_push else REQUIRED
    required = [job for job in jobs if job.get('name') in required_names]
    return (len(required) == len(required_names) and {job['name'] for job in required} == required_names
            and all(job.get('status') == 'completed' and job.get('conclusion') == 'success' for job in required))


if __name__ == '__main__':
    data = json.load(sys.stdin)
    passed = source_ci_passed(data['run'], data['jobs'], sys.argv[1])
    print('EXACT_SOURCE_JOBS_PASS' if passed else 'EXACT_SOURCE_JOBS_NOT_READY')
    sys.exit(0 if passed else 2)
