#!/usr/bin/env bash
# Run the unchanged native-UID tests; copy only their four explicit inputs if needed.
set -euo pipefail
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
python=$(command -v -- "${1:-python3}")
[[ "$python" == /* && -x "$python" ]]
[[ -x /usr/bin/timeout && -x /usr/bin/env ]]
scratch=$(mktemp -d /tmp/dash-proof-tests.XXXXXX)
scratch_identity=$(stat -c '%d:%i' -- "$scratch")
privileged_cleanup=0
cleanup() {
  local original=$?
  trap - EXIT
  if [[ ! "$scratch" =~ ^/tmp/dash-proof-tests\.[A-Za-z0-9]{6}$ || -L "$scratch" || ! -d "$scratch" ]] ||
      [[ $(stat -c '%d:%i' -- "$scratch") != "$scratch_identity" ]]; then
    echo 'READBACK_TEST_SCRATCH_IDENTITY_FAILED' >&2
    if (( original == 0 )); then original=1; fi
  elif (( privileged_cleanup )); then
    if ! sudo -n /bin/rm -rf --one-file-system -- "$scratch"; then
      echo 'READBACK_TEST_SCRATCH_CLEANUP_FAILED' >&2
      if (( original == 0 )); then original=1; fi
    fi
  elif ! /bin/rm -rf --one-file-system -- "$scratch"; then
    echo 'READBACK_TEST_SCRATCH_CLEANUP_FAILED' >&2
    if (( original == 0 )); then original=1; fi
  fi
  exit "$original"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

prefix=()
profile=direct
if [[ $(id -u) == 1000 && $(id -g) == 1000 ]]; then
  test_dir=$script_dir
else
  [[ -x /usr/bin/setpriv ]]
  mkdir -p -- "$scratch/.github/ci" "$scratch/.github/workflows"
  for file in test_worker_observation_release.py test_attempt_proof_readback.py attempt_proof_readback.py; do
    [[ -f "$script_dir/$file" && ! -L "$script_dir/$file" ]]
    cp -- "$script_dir/$file" "$scratch/.github/ci/$file"
    chmod 600 -- "$scratch/.github/ci/$file"
  done
  workflow="$script_dir/../workflows/ci.yml"
  [[ -f "$workflow" && ! -L "$workflow" ]]
  cp -- "$workflow" "$scratch/.github/workflows/ci.yml"
  chmod 600 -- "$scratch/.github/workflows/ci.yml"
  # Set the cleanup mode first: a partially successful chown still needs this owner.
  privileged_cleanup=1
  sudo -n /bin/chown -R 1000:1000 -- "$scratch"
  prefix=(sudo -n /usr/bin/setpriv --reuid=1000 --regid=1000 --clear-groups --)
  profile=cleared
  test_dir="$scratch/.github/ci"
fi

"${prefix[@]}" /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR="$scratch" \
  /usr/bin/timeout --kill-after=5s 90s "$python" -I -B - "$test_dir" "$profile" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys

assert sys.version_info[:2] == (3, 12), 'READBACK_TEST_PYTHON_VERSION_INVALID'
assert os.geteuid() == os.getuid() == os.getegid() == os.getgid() == 1000, 'READBACK_TEST_IDENTITY_INVALID'
if sys.argv[2] == 'cleared':
    assert os.getgroups() == [], 'READBACK_TEST_SUPPLEMENTARY_GROUPS_NOT_CLEARED'
print(json.dumps({'scope': 'NATIVE_READBACK_TEST_PROFILE', 'uid': os.geteuid(), 'gid': os.getegid(),
                  'supplementary_group_count': len(os.getgroups()), 'python_major': 3, 'python_minor': 12}), flush=True)
root = Path(sys.argv[1])
for name in ('test_worker_observation_release.py', 'test_attempt_proof_readback.py'):
    subprocess.run([sys.executable, '-I', '-B', str(root / name)], check=True, timeout=35)
PY
