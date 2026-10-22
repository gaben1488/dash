"""Transparent diagnostics for the original frozen trial on an ephemeral runner.

Never called on the VPS. Actual trial code, images, archive and native programs
are unchanged. Failed outputs stay private; bounded runner timings never include
the archive/image transfer that happens before this helper starts.
Phase durations include nested work and must not be summed with command timings.
RETURNED means subprocess.run returned; its exit code still determines success.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path
from unittest.mock import patch

PHASES = {'check_source_ci', '_files', '_images', 'restore_state', '_validated_backup',
          '_validate_archive_content', '_restore_compressed', 'inventory',
          'verify_restored_documents_and_sqlite', 'native_environment'}
CODES = {'RELEASE_TRIAL_STORAGE_INSUFFICIENT', 'RELEASE_TRIAL_AUTH_UNAVAILABLE', 'RELEASE_TRIAL_ENV_INVALID', 'RELEASE_COMMAND_FAILED', 'RELEASE_NATIVE_TRIAL_FAILED', 'RELEASE_SOURCE_CI_INVALID',
         'RELEASE_OWNED_FILE_INVALID', 'RELEASE_CONFIG_CHANGED', 'RELEASE_TOOL_CHANGED',
         'RELEASE_CHECKPOINT_CHANGED', 'RELEASE_WORD_PROOF_INVALID', 'RELEASE_TRIAL_IMAGE_UNAVAILABLE',
         'BACKUP_MISMATCH', 'BACKUP_SQLITE_INVALID', 'BACKUP_DOCX_INVALID', 'BACKUP_STATE_INCOMPLETE',
         'BACKUP_STORAGE_INSUFFICIENT', 'BACKUP_UNSAFE_FILE', 'BACKUP_MANIFEST_INVALID'}
COMMANDS = {'candidate_native', 'previous_native', 'reader_initialization', 'image_inspect', 'container_probe', 'other'}
TIMING_LIMIT = 64
MAX_TIMING_MS = 86_400_000


def clock():
    try:
        value = time.monotonic()
        return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None
    except Exception:  # noqa: BLE001 — failed observation must not replace the native trial result.
        return None


def elapsed(start, end, timings):
    if start is None or end is None or not 0 <= end - start <= MAX_TIMING_MS / 1000:
        timings['clock_anomalies'] += 1
        return None
    return int((end - start) * 1000)


def command_name(args, kwargs):
    argv = args[0] if args else kwargs.get('args')
    if isinstance(argv, (list, tuple)) and len(argv) >= 2 and argv[0] == '/usr/bin/docker':
        if argv[1] == 'run':
            if argv[-1] in ('candidate', 'previous'):
                return argv[-1] + '_native'
            if 'initialize-publication-readers' in argv:
                return 'reader_initialization'
        if list(argv[1:3]) == ['image', 'inspect']:
            return 'image_inspect'
        if argv[1] == 'ps':
            return 'container_probe'
    return 'other'


def public_timings(timings):
    """Project only fixed names and bounded integers, even from a malformed receipt."""
    def number(value, maximum=MAX_TIMING_MS):
        return value if type(value) is int and 0 <= value <= maximum else None
    value = {'scope': 'RUNNER_ONLY', 'transfer': 'NOT_MEASURED',
             'runner_elapsed_ms': number(timings.get('runner_elapsed_ms'))}
    for name in ('clock_anomalies', 'dropped_phases', 'dropped_commands'):
        value[name] = number(timings.get(name), 2**31 - 1)
    for kind in ('phases', 'commands'):
        value[kind] = []
        records = timings.get(kind)
        if not isinstance(records, list):
            continue
        for record in records[:TIMING_LIMIT]:
            if (not isinstance(record, dict) or not isinstance(record.get('phase'), str)
                    or record['phase'] not in PHASES | {'entry'}):
                continue
            item = {'phase': record['phase'], 'elapsed_ms': number(record.get('elapsed_ms'))}
            if kind == 'phases':
                item['call'] = number(record.get('call'), 2**31 - 1)
            else:
                if (not isinstance(record.get('command'), str) or record['command'] not in COMMANDS
                        or not isinstance(record.get('outcome'), str) or record['outcome'] not in {'RETURNED', 'RAISED'}):
                    continue
                item.update(command=record['command'], outcome=record['outcome'])
                code = record.get('returncode')
                item['returncode'] = code if type(code) is int and abs(code) <= 2**31 - 1 else None
            value[kind].append(item)
    return value


def diagnose(trial, plan):
    result = {'state': 'FROZEN_TRIAL_REPLAY_FAILED', 'phase': 'entry', 'process_failures': []}
    timings = {'scope': 'RUNNER_ONLY', 'transfer': 'NOT_MEASURED', 'phases': [], 'commands': [],
               'clock_anomalies': 0, 'dropped_phases': 0, 'dropped_commands': 0}
    result['timings'] = timings
    started = clock()
    active, calls = {}, {}
    def record(kind, value):
        if len(timings[kind]) < TIMING_LIMIT:
            timings[kind].append(value)
        else:
            timings['dropped_' + kind] += 1
    original_run, original_profile = subprocess.run, sys.getprofile()
    def profile(frame, event, arg):
        if (event == 'call' and frame.f_code.co_name in PHASES
                and Path(frame.f_code.co_filename).name in {'stateful_backup.py', 'release_recovery.py', 'release_trial.py'}):
            result['phase'] = frame.f_code.co_name
            name = frame.f_code.co_name
            calls[name] = calls.get(name, 0) + 1
            if len(active) < TIMING_LIMIT:
                active[id(frame)] = (name, calls[name], clock())
            else:
                timings['dropped_phases'] += 1
        elif event == 'return' and id(frame) in active:
            name, call, start = active.pop(id(frame))
            # Profile returns also cover exception unwinding; duration is not a success claim.
            record('phases', {'phase': name, 'call': call, 'elapsed_ms': elapsed(start, clock(), timings)})
    def captured(*args, **kwargs):
        start, outcome, value = clock(), 'RAISED', None
        phase = next(reversed(active.values()))[0] if active else 'entry'
        try:
            value = original_run(*args, **kwargs)
            outcome = 'RETURNED'
        finally:
            record('commands', {'command': command_name(args, kwargs), 'phase': phase,
                                'outcome': outcome, 'returncode': None if value is None else value.returncode,
                                'elapsed_ms': elapsed(start, clock(), timings)})
        if value.returncode:
            def bounded(body):
                return body[-65536:].decode('utf-8', errors='replace') if isinstance(body, bytes) else (body or '')[-65536:]
            result['process_failures'].append({'returncode': value.returncode, 'stdout': bounded(value.stdout), 'stderr': bounded(value.stderr)})
            result['process_failures'] = result['process_failures'][-8:]
        return value
    try:
        sys.setprofile(profile)
        with patch('subprocess.run', captured):
            result['proof'] = trial.run(plan)
        result.update(state='FROZEN_TRIAL_REPLAY_PASS', phase='complete')
    except Exception as error:  # noqa: BLE001 - errors remain in the private diagnostic receipt
        result.update(error_code=str(error) if str(error) in CODES else 'FROZEN_REPLAY_FAILED',
                      exception_type=type(error).__name__, private_trace=traceback.format_exc(limit=20),
                      frames=[{'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
                              for frame in traceback.extract_tb(error.__traceback__)[-8:]])
    finally:
        sys.setprofile(original_profile)
        timings['runner_elapsed_ms'] = elapsed(started, clock(), timings)
    return result


def public_summary(result):
    value = {key: result[key] for key in ('state', 'phase', 'error_code', 'exception_type', 'frames') if key in result}
    native_codes = {'auth','health','status','latest','schema','history','symlink','size','historyschema','word','runtime'}
    codes = sorted({line.removeprefix('NATIVE_TRIAL_FAILURE=')
                    for failure in result.get('process_failures',[]) for line in failure.get('stderr','').splitlines()
                    if line.startswith('NATIVE_TRIAL_FAILURE=') and line.removeprefix('NATIVE_TRIAL_FAILURE=') in native_codes})
    if codes:value['native_failure_codes'] = codes
    if isinstance(result.get('timings'), dict):
        value['timings'] = public_timings(result['timings'])
    if result['state'] == 'FROZEN_TRIAL_REPLAY_PASS':
        value.update({key: result['proof']['full_restore'][key] for key in ('sqlite_checked', 'docx_checked')})
    return value


def main():
    assert os.geteuid() == 0 and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_result', type=Path)
    parser.add_argument('--release-proof', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    sys.dont_write_bytecode = True
    sys.path.insert(0, '/usr/local/libexec/aemr')
    import release_recovery as r
    import release_trial
    plan = json.loads(r.read_owned(r.RUNTIME_DIR / 'trial-plan.json'))
    result = diagnose(release_trial.ReleaseTrial(), plan)
    target = args.private_result
    with target.open('x', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(result, stream)
    emitted = result['proof'] if args.release_proof and result['state'] == 'FROZEN_TRIAL_REPLAY_PASS' else public_summary(result)
    print(json.dumps(emitted, sort_keys=True))
    return 0 if result['state'] == 'FROZEN_TRIAL_REPLAY_PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
