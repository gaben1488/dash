"""Exact source-job proof for maintenance admission; never a deployment/live proof."""
import json
import re
import sys

REQUIRED = {'Lint, TypeScript, Tests, Build, Audit',
            'Report engine, publication and runtime', 'Production image with report runtime'}


def source_ci_passed(run, jobs, sha):
    # Historical PR admission is unchanged. The sole new production path is an
    # owner-initiated push on PR79 integration or pinned PR129 release, admitted
    # only against the exact tested SHA and the same three mandatory jobs.
    owner_integrated_push = (
        run.get('event') == 'push'
        and run.get('head_branch') in ('codex/dash-audit-integrated-20261010', 'release/dash79-modern-forward-20261022')
        and (run.get('actor') or {}).get('login') == 'gaben1488'
    )
    if (not re.fullmatch('[a-f0-9]{40}', sha) or run.get('head_sha') != sha
            or run.get('name') != 'CI'
            or not (run.get('event') == 'pull_request' or owner_integrated_push)
            or run.get('path') != '.github/workflows/ci.yml'
            or (run.get('head_repository') or {}).get('full_name') != 'gaben1488/dash'):
        return False
    required = [job for job in jobs if job.get('name') in REQUIRED]
    return (len(required) == len(REQUIRED) and {job['name'] for job in required} == REQUIRED
            and all(job.get('status') == 'completed' and job.get('conclusion') == 'success' for job in required))


if __name__ == '__main__':
    data = json.load(sys.stdin)
    passed = source_ci_passed(data['run'], data['jobs'], sys.argv[1])
    print('EXACT_SOURCE_JOBS_PASS' if passed else 'EXACT_SOURCE_JOBS_NOT_READY')
    sys.exit(0 if passed else 2)
