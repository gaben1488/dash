#!/usr/bin/env bash
# Run from deploy/. All private source and report output stays inside server_data.
set -euo pipefail

docker compose --env-file .env.production --profile reports stop report-worker >/dev/null
docker compose --env-file .env.production exec -T server sh -eu -c '
  umask 077
  mkdir -p data/reports
  /opt/report-env/bin/proc-report bootstrap-google --inputs data/reports/inputs >data/reports/bootstrap.log 2>&1
'
docker compose --env-file .env.production exec -T server sh -eu -c '
  umask 077
  /opt/report-env/bin/proc-report run-google --registry data/reports/inputs/registry.json --ledger data/reports/inputs/ledger.json --state data/reports >data/reports/preflight.log 2>&1
  /opt/report-env/bin/python -c '\''import json; from pathlib import Path; s=json.loads(Path("data/reports/status.json").read_text()); assert s["status"] in {"VERIFIED", "VERIFIED_WITH_WARNINGS"}'\''
'
docker compose --env-file .env.production --profile reports up -d report-worker >/dev/null
