"""Complete the already staged candidate only through unchanged native acceptance."""
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
import time
from pathlib import Path

SHA = '394c7e853a2b326b9a5c89ea52f60c51e075302e'
RUN = '38792810076'


def main():
    assert os.geteuid() == 0
    tools = Path('/usr/local/libexec/aemr')
    runtime = Path('/var/lib/aemr/release-runtime')
    session = Path('/home/aemr/.dash-private-backups') / ('worker-' + RUN)
    for path in (tools, runtime, session):
        assert not any(p.is_symlink() for p in (path, *path.parents))
        assert path.stat().st_uid == 0 and not path.stat().st_mode & 0o022
    # Pins are fixed by the original independent full-restore gate; no tool,
    # candidate image, contract, checkpoint, or source is replaced by this retry.
    with os.fdopen(os.open(session / 'release-window.json', os.O_RDONLY | os.O_NOFOLLOW), 'rb') as file:
        info = os.fstat(file.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
        assert stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 65536
        window = json.load(file)
    assert set(window) == {'format', 'candidate', 'run_id', 'module_sha256', 'boot_id', 'deadline_ns'}
    assert window['format'] == 'aemr-release-window-v1'
    assert window['candidate'] == SHA and window['run_id'] == RUN
    assert window['boot_id'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    assert type(window['deadline_ns']) is int
    names = {'release-controller.py', 'release_recovery.py', 'release_trial.py', 'stateful_backup.py', 'source_ci_gate.py'}
    assert set(window['module_sha256']) == names
    for name, digest in window['module_sha256'].items():
        path = tools / name
        assert re.fullmatch('[a-f0-9]{64}', digest)
        assert not path.is_symlink() and path.stat().st_uid == 0 and not path.stat().st_mode & 0o022
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    sys.path.insert(0, str(tools))
    import release_recovery as r
    r.require_lock(9)
    spec = importlib.util.spec_from_file_location('pinned_release_controller', tools / 'release-controller.py')
    controller = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(controller)
    executor = r.ReleaseRecovery()
    command = executor.command
    def measured(args, **kwargs):
        stage = None
        if args[:2] == ['exec', 'aemr-server-1']:
            stage = ('startup_warmup' if 'EXISTING_CANDIDATE_STARTUP_WARMUP' in args[-1] else 'schema') if args[2] == './node_modules/.bin/tsx' else 'word' if args[2] == 'python3' else None
        started = time.monotonic()
        try:
            return command(args, **kwargs)
        finally:
            if stage:
                print(json.dumps({'native_stage': stage, 'elapsed_ms': int((time.monotonic()-started)*1000)}), flush=True)
    executor.command = measured
    operator = controller.ReleaseController(executor)
    plan = operator._proof(r.validate_plan(json.loads(r.read_owned(runtime / 'trial-plan.json'))))
    assert plan['release_sha'] == SHA
    plan_hash = r.digest(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode())
    expected = executor._acceptance(plan)
    progress_path = r.STATE_DIR / 'release-recovery-progress.json'
    accepted_path = r.STATE_DIR / 'release-accepted.json'
    progress = json.loads(r.read_owned(progress_path)) if os.path.lexists(progress_path) else None
    durable = json.loads(r.read_owned(accepted_path)) if os.path.lexists(accepted_path) else None
    if progress is not None:
        assert r.validate_progress(progress) == {'plan_sha256': plan_hash, 'phase': 'candidate_accept', 'acceptance': expected}
    if durable is not None:
        assert durable == {'plan_sha256': plan_hash, 'acceptance': expected}
    if os.path.lexists(r.PENDING):
        assert r.validate_plan(json.loads(r.read_owned(r.PENDING))) == plan
        assert durable is None or progress is not None
    else:
        assert durable is not None
        if progress is not None:
            # Existing pinned recovery retires only the matching completed
            # progress after a crash between pending/progress unlink.
            assert executor.recover() is None
            progress = None
    assert plan['backup_reference'] == 'worker-' + RUN + '/backup'
    assert plan['original_running']['report-worker'] is False
    _, config = executor._files(plan, candidate_runtime=True)
    records = executor._records(plan, candidate=True)
    operator._saved_runtime({**plan, 'images': plan['candidate_images']}, records,
                            json.loads(json.dumps(config).replace('$$', '$')))
    assert records['server']['State']['Status'] == 'running'
    assert records['server']['State']['Health']['Status'] == 'healthy'
    assert records['web']['State']['Status'] == 'running'
    assert records['report-worker']['State']['Status'] in {'created', 'exited'}
    assert records['caddy']['State']['Status'] in ({'running', 'created', 'exited'} if progress is not None or durable is not None else {'created', 'exited'})
    for service in ('server', 'web'):
        image = json.loads(executor.command(['image', 'inspect', plan['candidate_images'][service]]))[0]
        assert image['Config']['Labels']['org.opencontainers.image.revision'] == SHA
    print('EXISTING_FULL_TRIAL_AND_CANDIDATE_PINS_PASS', flush=True)
    if durable is None:
        warmup_program = "// EXISTING_CANDIDATE_STARTUP_WARMUP\n(async()=>{\n const {DashboardDataSchema}=await import('@aemr/shared');\n delete process.env.HEADER_PROBE_CLI;\n const {validHeaderPayload}=await import('/opt/aemr/header_api_probe.mjs');\n const token=process.env.AEMR_API_KEY;if(!token)throw Error('auth');\n const deadline=Date.now()+240000,checks=[];\n for(const [name,path] of [['journal','/api/change-story?limit=1'],['currentYear','/api/dashboard?year=2026'],['allYears','/api/dashboard']]){\n  const started=Date.now();let status=null,size=0;\n  try{\n   const remaining=deadline-Date.now();if(remaining<=0)throw Error('budget');\n   const response=await fetch('http://127.0.0.1:3000'+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(Math.min(120000,remaining))});status=response.status;\n   if(status!==200){response.body?.cancel().catch(()=>{});throw Error('status');}\n   const chunks=[];for await(const part of response.body){size+=part.length;if(size>32*1024*1024)throw Error('size');chunks.push(part);}\n   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));\n   const valid=name==='journal'?validHeaderPayload('journal',data):DashboardDataSchema.safeParse(data).success;\n   checks.push({name,status,valid,bytes:size,elapsed_ms:Date.now()-started});\n   if(!valid)break;\n  }catch{checks.push({name,status,valid:false,bytes:size,elapsed_ms:Date.now()-started});break;}\n }\n console.log(JSON.stringify({startup_warmup:checks}));\n})().catch(()=>console.log(JSON.stringify({startup_warmup:[]})));\n"
        value = executor.command(['exec', 'aemr-server-1', './node_modules/.bin/tsx', '--eval', warmup_program], timeout=255)
        checked = json.loads(value)
        assert set(checked) == {'startup_warmup'}
        checks = checked['startup_warmup']
        assert isinstance(checks, list) and len(checks) <= 3
        for item in checks:
            assert set(item) == {'name', 'status', 'valid', 'bytes', 'elapsed_ms'}
            assert item['name'] in {'allYears', 'currentYear', 'journal'}
            assert item['status'] is None or type(item['status']) is int
            assert type(item['valid']) is bool
            assert all(type(item[k]) is int and 0 <= item[k] <= 2**53-1 for k in ('bytes', 'elapsed_ms'))
        print(json.dumps(checked), flush=True)
        assert [item['name'] for item in checks] == ['journal', 'currentYear', 'allYears']
        assert all(item['valid'] and item['status'] == 200 for item in checks)
        print('STARTUP_DATA_PREPARED_NOT_ACCEPTED', flush=True)
    # Crucially, a failed accept preserves closed ingress. Do not call the old
    # general rollback path, whose historical-container scan masks that error.
    if durable is not None and not os.path.lexists(r.PENDING):
        executor._verify_api_word(plan, candidate=True)
        executor._verify_candidate_schema()
        assert records['caddy']['State']['Status'] == 'running'
    else:
        if progress is None:
            assert executor.accept() == expected
            print('EXISTING_CANDIDATE_NATIVE_ACCEPT_PASS', flush=True)
        assert executor.recover() == expected
    assert not os.path.lexists(r.PENDING)
    assert not os.path.lexists(r.STATE_DIR / 'release-recovery-progress.json')
    durable = json.loads(r.read_owned(r.STATE_DIR / 'release-accepted.json'))
    assert durable == {'plan_sha256': plan_hash, 'acceptance': expected}
    # Original guardian is absent; this EX owner completes the same verified
    # window only after durable acceptance. No state restore or image changes.
    cleanup = []
    request = runtime / 'guardian-request.json'
    if os.path.lexists(request):
        assert json.loads(r.read_owned(request)) == {'candidate': SHA, 'run_id': RUN, 'plan_sha256': plan_hash, 'stage': 'deploy'}
        cleanup.append(request)
    request = session / 'cancel-request.json'
    if os.path.lexists(request):
        original = r.read_owned(session / 'runtime.json')
        assert json.loads(r.read_owned(request)) == {'candidate': SHA, 'run_id': RUN, 'runtime_sha256': r.digest(original)}
        cleanup.append(request)
    for name in ('quiescent', 'worker-draining'):
        path = session / name
        if os.path.lexists(path):
            r.read_owned(path)
            cleanup.append(path)
    for path in cleanup:
        path.unlink()
    r.fsync_directory(session)
    r.fsync_directory(runtime)
    print('EXISTING_EXACT_CANDIDATE_ACCEPTED_AND_RESUMED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:  # noqa: BLE001 - fixed public diagnostics boundary
        # Fixed-code diagnostics only; never print runtime source values.
        code = str(error)
        allowed = {'RELEASE_COMMAND_FAILED', 'RELEASE_CANDIDATE_SCHEMA_INVALID', 'RELEASE_API_NOT_HEALTHY', 'RELEASE_NATIVE_WORD_MISMATCH', 'RELEASE_RUNTIME_NOT_OWNED', 'RELEASE_SOURCE_CI_INVALID', 'RELEASE_ACCEPTED_RUNTIME_UNAVAILABLE', 'RELEASE_TRIAL_PROOF_INVALID', 'RELEASE_LOCK_REQUIRED'}
        print(code if code in allowed else 'EXISTING_RELEASE_FINISH_REJECTED', flush=True)
        kind = type(error).__name__
        print(json.dumps({'finish_failure_type': kind if kind in {'AssertionError', 'FileNotFoundError', 'PermissionError', 'RecoveryError'} else 'OtherError', 'entry_line': error.__traceback__.tb_lineno}), flush=True)
        sys.exit(2)
