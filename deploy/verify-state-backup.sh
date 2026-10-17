#!/usr/bin/env bash
# Только после разрешённой остановки записи в server_data. НИЧЕГО не останавливает.
# Использование: bash deploy/verify-state-backup.sh /private/backup-parent RELEASE-ID
set -euo pipefail
umask 077

fail() { printf '%s\n' "$1" >&2; exit 2; }
[ "$#" -eq 2 ] || fail "BACKUP_ARGUMENTS_REQUIRED"
BACKUP_PARENT=$1
BACKUP_NAME=$2
case "$BACKUP_NAME" in
  ''|*[!A-Za-z0-9._-]*) fail "BACKUP_NAME_INVALID" ;;
esac
case "$BACKUP_PARENT" in
  /*) ;;
  *) fail "BACKUP_DESTINATION_NOT_ABSOLUTE" ;;
esac
[ -d "$BACKUP_PARENT" ] || fail "BACKUP_DESTINATION_UNAVAILABLE"
BACKUP_PARENT=$(cd "$BACKUP_PARENT" && pwd -P)
[ ! -e "$BACKUP_PARENT/$BACKUP_NAME" ] || fail "BACKUP_TARGET_EXISTS"

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_DIR=$(dirname "$DEPLOY_DIR")
case "$BACKUP_PARENT/" in
  "$REPO_DIR/"*) fail "BACKUP_DESTINATION_INSIDE_REPOSITORY" ;;
esac
cd "$DEPLOY_DIR"

# The helper cannot stop services by itself. An operator must quiesce BOTH
# Node server and report-worker in an approved window.
server=$(docker compose --env-file .env.production ps --all --quiet server)
[ -n "$server" ] || fail "BACKUP_SERVER_CONTAINER_MISSING"
server_state=$(docker inspect --format '{{.State.Status}}' "$server")
[ "$server_state" = exited ] || fail "BACKUP_REQUIRES_SERVER_QUIESCENCE"
worker=$(docker compose --env-file .env.production --profile reports ps --all --quiet report-worker)
if [ -n "$worker" ]; then
  worker_state=$(docker inspect --format '{{.State.Status}}' "$worker")
  case "$worker_state" in
    exited|created) ;;
    *) fail "BACKUP_REQUIRES_WORKER_QUIESCENCE" ;;
  esac
fi

volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/packages/server/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$server")
case "$volume" in
  ''|*[!a-zA-Z0-9_.-]*) fail "BACKUP_SOURCE_VOLUME_NOT_VERIFIED" ;;
esac
image=$(docker inspect --format '{{.Image}}' "$server")
case "$image" in
  sha256:*) ;;
  *) fail "BACKUP_IMAGE_NOT_VERIFIED" ;;
esac
# Production server_data is read-only in both runs. No env file, network,
# service account or production host process is available in the containers.
docker run --rm --network none --read-only --user 0 \
  --mount "type=volume,src=$volume,dst=/source,readonly" \
  --mount "type=bind,src=$BACKUP_PARENT,dst=/backups" \
  --mount "type=bind,src=$DEPLOY_DIR/stateful_backup.py,dst=/tool.py,readonly" \
  --entrypoint /opt/report-env/bin/python "$image" /tool.py create \
  --source /source --backup "/backups/$BACKUP_NAME"

# Copy to a disposable Docker volume, check every byte and SQLite/Word
# content, then discard scratch. Original remains read-only.
docker run --rm --network none --read-only --user 0 \
  --mount "type=volume,src=$volume,dst=/source,readonly" \
  --mount "type=bind,src=$BACKUP_PARENT,dst=/backups,readonly" \
  --mount "type=bind,src=$DEPLOY_DIR/stateful_backup.py,dst=/tool.py,readonly" \
  --mount type=volume,dst=/scratch \
  --entrypoint /opt/report-env/bin/python "$image" /tool.py verify \
  --backup "/backups/$BACKUP_NAME" --scratch-parent /scratch --source /source
echo 'BACKUP_AND_SCRATCH_RESTORE_PASS'
