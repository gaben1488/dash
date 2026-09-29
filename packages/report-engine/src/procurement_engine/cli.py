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
    worker = sub.add_parser("worker", help="Periodically acquire, verify and attempt publication")
    worker.add_argument("--registry", required=True)
    worker.add_argument("--ledger", required=True)
    worker.add_argument("--state", required=True)
    worker.add_argument("--interval-seconds", type=int, default=900)
    read = sub.add_parser("read-publication", help="Read a committed release without live recalculation")
    read.add_argument("--state", required=True)
    read.add_argument("--view", choices=['status', 'dashboard', 'main', 'supplement'], required=True)
    read.add_argument("--release-id")
    args = p.parse_args(argv)
    if args.cmd == 'bootstrap-google':
        from .runtime_inputs import install_google_inputs
        install_google_inputs(args.inputs)
        print('Runtime inputs ready')
        return 0
    if args.cmd == "worker":
        from .worker import work
        return work(args.registry, args.ledger, args.state, interval_seconds=args.interval_seconds)
    if args.cmd == "read-publication":
        from .publication_reader import read_publication
        from .publication_store import PublicationError
        try:
            result = read_publication(args.state, args.view, args.release_id)
        except PublicationError as error:
            print(str(error), file=sys.stderr)
            return 4 if str(error) == 'PUBLICATION_NOT_FOUND' else 2
        sys.stdout.buffer.write(result)
        return 0
    if args.cmd == "run-google":
        from .runtime import run_once
        status = run_once(args.registry, args.ledger, args.state)
        dump(status)
        return 0 if status['status'] in {'VERIFIED', 'VERIFIED_WITH_WARNINGS', 'ALREADY_RUNNING'} else 2
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
