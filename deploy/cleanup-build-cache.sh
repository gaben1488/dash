#!/usr/bin/env bash
# Owner-authorized regenerable cache only. Never remove images, containers or volumes.
set -euo pipefail
umask 077
exec 9>/tmp/dash-build-cache-cleanup.lock
flock -n 9 || { echo 'CACHE_CLEANUP_ALREADY_RUNNING' >&2; exit 2; }

protected_state() {
  local containers
  containers=$(docker ps --all --filter label=com.docker.compose.project \
    --filter label=com.docker.compose.oneoff=False --quiet --no-trunc) || return 2
  [ -n "$containers" ] || { echo 'CACHE_PROTECTED_CONTAINERS_MISSING' >&2; return 2; }
  # Hash only stable deployment state; never print environment or source contents.
  {
    for container in $containers; do
      docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}|{{json .Mounts}}' "$container" | python3 -c '
import json, sys
try:
    ident, image, status, raw = sys.stdin.read().strip().split("|", 3)
    mounts = json.loads(raw)
    if not isinstance(mounts, list) or any(not isinstance(m, dict) for m in mounts):
        raise ValueError()
    # Docker mount order is not semantic; retain every field of each mount.
    normalized = sorted(json.dumps(m, sort_keys=True, separators=(",", ":")) for m in mounts)
    print(ident + "|" + image + "|" + status + "|" + json.dumps(normalized))
except (ValueError, TypeError):
    print("CACHE_PROTECTED_STATE_UNREADABLE", file=sys.stderr)
    sys.exit(2)
' || return 2
    done
    docker image ls --all --no-trunc --format '{{.ID}}|{{.Repository}}:{{.Tag}}'
  } | LC_ALL=C sort | sha256sum | cut -d' ' -f1
}

before=$(protected_state)
free_before=$(df -PB1 / | awk 'NR==2 {print $4}')
docker system df
docker builder prune --all --force
after=$(protected_state)
[ "$before" = "$after" ] || { echo 'CACHE_PROTECTED_STATE_CHANGED' >&2; exit 2; }
free_after=$(df -PB1 / | awk 'NR==2 {print $4}')
docker system df
printf '{"free_before_bytes":%s,"free_after_bytes":%s,"net_free_change_bytes":%s}\n' \
  "$free_before" "$free_after" "$((free_after-free_before))"
echo 'CACHE_ONLY_CLEANUP_PASS'
