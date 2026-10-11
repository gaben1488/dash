"""Private read-only census before weekly retention; never removes files or rows.

Only aggregate output goes to Actions. The release IDs remain in memory so an
operator can later bind a tested retirement transaction to this exact plan.
The shared planner checks release file hashes, not full replay acceptance or
permission to execute deletion. Reclaimable bytes are an upper bound before
retaining exact downloads and historical decision proofs.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def plan(state):
    # One keep-policy implementation shared with the reversible apply phase.
    # This adapter remains read-only and preserves the existing census CLI.
    from procurement_engine.publication_store import PublicationStore

    store = PublicationStore(Path(state) / 'published', readonly=True)
    result = store.plan_compaction()
    result.pop('records')
    result['status'] = 'READ_ONLY_PLAN'
    result['bytes_reclaimable'] = result.pop('bytes_reclaimable_upper_bound')
    result['bytes_reclaimable_kind'] = 'upper_bound_before_retained_artifacts_and_proofs'
    return result


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    args = parser.parse_args(argv)
    try:
        result = plan(args.state)
    except Exception:  # noqa: BLE001 — CLI boundary must never expose private paths or content.
        print(json.dumps({'status': 'CENSUS_BLOCKED', 'error_code': 'RETENTION_CENSUS_FAILED'}))
        return 2
    result.pop('keep_release_ids')
    result.pop('retire_release_ids')
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
