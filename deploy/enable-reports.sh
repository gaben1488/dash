#!/usr/bin/env bash
# Run from deploy/. All private source and report output stays inside server_data.
set -euo pipefail

previous_worker=$(docker compose --env-file .env.production --profile reports ps --status running --quiet report-worker)
restore_schedule_on_failure() {
  result=$?
  if [ "$result" -ne 0 ] && [ -n "$previous_worker" ]; then
    # Start the existing container; a failed preflight must not replace its image
    # or permanently disable the schedule that was running before this attempt.
    if ! docker compose --env-file .env.production --profile reports start report-worker >/dev/null; then
      echo 'Could not restore the previously running report worker.' >&2
    fi
  fi
  exit "$result"
}
trap restore_schedule_on_failure EXIT

docker compose --env-file .env.production --profile reports stop report-worker >/dev/null
docker compose --env-file .env.production exec -T server sh -eu -c '
  umask 077
  mkdir -p data/reports
  /opt/report-env/bin/proc-report bootstrap-google --inputs data/reports/inputs >data/reports/bootstrap.log 2>&1
'
echo 'Report inputs ready. Reading and checking report sources; detailed output stays on the server.'
docker compose --env-file .env.production exec -T server sh -eu -c '
  umask 077
  /opt/report-env/bin/proc-report run-google --registry data/reports/inputs/registry.json --ledger data/reports/inputs/ledger.json --state data/reports >data/reports/preflight.log 2>&1
  /opt/report-env/bin/python -c '\''import json; from pathlib import Path; s=json.loads(Path("data/reports/status.json").read_text()); assert s["status"] in {"VERIFIED", "VERIFIED_WITH_WARNINGS"}'\''
'
echo 'Report generated. Checking the native report context and both Word downloads.'
docker compose --env-file .env.production exec -T server /opt/report-env/bin/python -m procurement_engine.deployment_smoke
docker compose --env-file .env.production --profile reports up -d report-worker >/dev/null
echo 'Report exports verified; schedule started.'
