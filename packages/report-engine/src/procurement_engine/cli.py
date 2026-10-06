from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .recommendations import replay_ledger
from .report_model import build_report_model
from .validation import validation_report


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dump(data, path=None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if path:
        Path(path).write_text(text, encoding="utf-8")
    else:
        print(text)


def main(argv=None):
    p = argparse.ArgumentParser(prog="proc-report")
    sub = p.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("validate", help="Run fail-closed snapshot + ledger regression gates")
    v.add_argument("--snapshot", required=True)
    v.add_argument("--ledger", required=True)
    v.add_argument("--summary")
    v.add_argument("--out")

    r = sub.add_parser("replay-ledger", help="Re-evaluate semantic statuses from current evidence")
    r.add_argument("--ledger", required=True)
    r.add_argument("--out", required=True)

    m = sub.add_parser("build-report-model", help="Build renderer-independent report model JSON")
    m.add_argument("--snapshot", required=True)
    m.add_argument("--ledger", required=True)
    m.add_argument("--out", required=True)

    raw = sub.add_parser("build-from-capture", help="Build a diagnostic report from complete source matrices")
    raw.add_argument("--capture", required=True)
    raw.add_argument("--registry", required=True)
    raw.add_argument("--ledger", required=True)
    raw.add_argument("--out", required=True)
    raw.add_argument("--no-docx", action="store_true")
    raw.add_argument("--identity-db", help="Persistent SQLite identity observations, reused across runs")

    capture = sub.add_parser("capture-google", help="Read-only Google Sheets capture using service account credentials")
    capture.add_argument("--registry", required=True)
    capture.add_argument("--out", required=True)
    capture.add_argument("--timezone", default="Asia/Kamchatka")
    run = sub.add_parser("run-google", help="Capture, build, verify and attempt an atomic release")
    run.add_argument("--registry", required=True)
    run.add_argument("--ledger", required=True)
    run.add_argument("--state", required=True)
    bootstrap = sub.add_parser("bootstrap-google", help="Install private runtime inputs using the existing service account")
    bootstrap.add_argument("--inputs", required=True)
    migration = sub.add_parser("migrate-google-schema", help="Apply reviewed private reference header migrations")
    migration.add_argument("--registry", required=True)
    worker = sub.add_parser("worker", help="Periodically acquire, verify and attempt publication")
    worker.add_argument("--registry", required=True)
    worker.add_argument("--ledger", required=True)
    worker.add_argument("--state", required=True)
    worker.add_argument("--interval-seconds", type=int, default=900)
    prune = sub.add_parser("prune-state", help="Plan or compact old transient attempt payloads")
    prune.add_argument("--state", required=True)
    prune.add_argument("--keep-full", type=int, default=12)
    prune.add_argument("--apply", action="store_true")
    read = sub.add_parser("read-publication", help="Read a committed release without live recalculation")
    read.add_argument("--state", required=True)
    read.add_argument("--view", choices=['status', 'dashboard', 'main', 'supplement'], required=True)
    read.add_argument("--release-id")
    read.add_argument("--report-date")
    read.add_argument("--report-year", type=int)
    read.add_argument("--quarter", type=int)
    archive = sub.add_parser('run-archive', help='Build an exact archived context without current sources')
    archive.add_argument('--state', required=True)
    archive.add_argument('--report-date', required=True)
    archive.add_argument('--report-year', type=int, required=True)
    archive.add_argument('--quarter', type=int, required=True)
    archive.add_argument('--legacy-db', help='Read-only old dashboard snapshot catalog')
    file_archive = sub.add_parser('import-week-files', help='Seal registered original XLSX/ZIP inputs without live reads')
    file_archive.add_argument('--archive', required=True)
    file_archive.add_argument('--manifest', required=True)
    file_archive.add_argument('--state', required=True)
    revision_probe = sub.add_parser(
        'probe-master-revisions',
        help='Read-only capability check for exact historical master revisions',
    )
    revision_probe.add_argument('--registry', required=True)
    revision_probe.add_argument('--ledger', required=True)

    review = sub.add_parser('record-identity-review', help='Append dated proof to an existing identity observation')
    for option in ('state', 'snapshot-id', 'locator', 'uid', 'reviewer', 'reviewed-at', 'evidence'):
        review.add_argument('--' + option, required=True)

    args = p.parse_args(argv)
    if args.cmd == 'import-week-files':
        from .file_archive import FileArchiveError, _decode_json, import_file_archive
        try:
            manifest = _decode_json(Path(args.manifest).read_bytes())
            result = import_file_archive(args.archive, manifest, args.state)
        except (FileArchiveError, ValueError, OSError) as error:
            # CLI runs inside the private service; detailed coordinate evidence
            # is not published in GitHub logs or returned as an unsanitized trace.
            from .file_archive import INBOX_MESSAGE
            from .runtime import _write
            detail = error.issue if isinstance(error, FileArchiveError) else {'code': 'ARCHIVE_IMPORT_FAILED'}
            evidence_path = Path(args.state) / 'archive_intake/manual-error.json'
            saved = False
            try:
                evidence_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                _write(evidence_path, {**detail, 'owner': 'ENGINE', 'exception_class': type(error).__name__})
                evidence_path.chmod(0o600)
                saved = True
            except OSError:
                pass  # Failure to write diagnostics must not hide the source failure.
            result = {'status': 'NOT_IMPORTED', 'code': detail['code'], 'owner': 'ENGINE',
                      'message': INBOX_MESSAGE, 'evidence': 'archive_intake/manual-error.json' if saved else None}
            dump(result)
            return 2
        dump(result)
        return 0
    if args.cmd == 'run-archive':
        from .archive_runtime import MESSAGES, ArchiveError, ensure_archive_release
        try:
            result = ensure_archive_release(args.state, day=args.report_date,
                year=args.report_year, quarter=args.quarter, legacy_database=args.legacy_db)
        except ArchiveError as error:
            print(json.dumps({'code': str(error), 'message': MESSAGES.get(str(error), 'Некорректный период архива.')}, ensure_ascii=False))
            return 2
        # A missing archive is a typed business result, not a transport failure.
        dump(result)
        return 0
    if args.cmd == 'probe-master-revisions':
        from .google_adapter import GoogleReadClient
        from .master_revision_history import probe_exact_master_revisions
        from .recommendation_history import read_google_history

        registry = load(args.registry)
        client = GoogleReadClient()
        ledger, _, _ = read_google_history(client, load(args.ledger))
        dump(probe_exact_master_revisions(registry, ledger, client))
        return 0
    if args.cmd == 'record-identity-review':
        from .identity_store import IdentityStore

        database = Path(args.state) / 'identity.sqlite'
        if not database.is_file():
            raise ValueError('IDENTITY_DATABASE_MISSING')
        review_id = IdentityStore(database).record_review(snapshot_id=args.snapshot_id,
            locator=args.locator, uid=args.uid, reviewer=args.reviewer, reviewed_at=args.reviewed_at,
            evidence=load(args.evidence))
        dump({'review_id': review_id})
        return 0
    if args.cmd == 'migrate-google-schema':
        from .schema_migrations import apply_google_schema_migrations
        print(json.dumps({'reviewed_schema_migrations_applied': apply_google_schema_migrations(args.registry)}))
        return 0
    if args.cmd == 'bootstrap-google':
        from .runtime_inputs import install_google_inputs
        install_google_inputs(args.inputs)
        print('Runtime inputs ready')
        return 0
    if args.cmd == "prune-state":
        from .retention import apply_transient_attempt_retention, plan_transient_attempt_retention

        plan = plan_transient_attempt_retention(args.state, keep_full=args.keep_full)
        result = (apply_transient_attempt_retention(
            args.state, keep_full=args.keep_full, expected_attempts=plan["compact_attempts"])
            if args.apply else plan)
        # Attempt UUIDs are an internal compare-and-delete barrier, not useful
        # operational output and must not be copied into CI logs.
        dump({key: value for key, value in result.items() if key != "compact_attempts"})
        return 0 if result.get("status") not in {"FAILED", "PLAN_CHANGED"} else 2
    if args.cmd == "worker":
        from .worker import work
        return work(args.registry, args.ledger, args.state, interval_seconds=args.interval_seconds)
    if args.cmd == "read-publication":
        from .publication_reader import read_publication
        from .publication_store import PublicationError
        try:
            selection = (args.report_date, args.report_year, args.quarter)
            result = read_publication(args.state, args.view, args.release_id,
                                      selection=selection if any(x is not None for x in selection) else None)
        except PublicationError as error:
            print(str(error), file=sys.stderr)
            return 4 if str(error) == 'PUBLICATION_NOT_FOUND' else 2
        sys.stdout.buffer.write(result)
        return 0
    if args.cmd == "run-google":
        from .runtime import run_once
        status = run_once(args.registry, args.ledger, args.state)
        dump(status)
        return 0 if status['status'] in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'} else 2
    if args.cmd == "capture-google":
        from .google_adapter import capture_google
        if Path(args.out).exists():
            raise ValueError("CAPTURE_OUTPUT_ALREADY_EXISTS")
        dump(capture_google(load(args.registry), timezone_name=args.timezone), args.out)
        return 0
    if args.cmd == "build-from-capture":
        from .identity_store import IdentityStore
        from .raw_pipeline import build_from_capture
        model = build_from_capture(load(args.capture), load(args.registry), load(args.ledger), args.out,
                                   render_docx=not args.no_docx,
                                   identity_store=IdentityStore(args.identity_db) if args.identity_db else None)
        dump({"snapshot_id": model["snapshot"]["snapshot_id"], "release": model["release"],
              "headline": model["headline"]})
        return 2 if not model["release"]["official_release_allowed"] else 0
    if args.cmd == "validate":
        report = validation_report(load(args.snapshot), load(args.ledger), load(args.summary) if args.summary else None)
        dump(report, args.out)
        return 0 if report["pass"] else 2
    if args.cmd == "replay-ledger":
        dump(replay_ledger(load(args.ledger)), args.out)
        return 0
    if args.cmd == "build-report-model":
        dump(build_report_model(load(args.snapshot), load(args.ledger)), args.out)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
