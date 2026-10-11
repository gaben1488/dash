#!/usr/bin/env python3
"""Проверяемая копия всего server_data и отдельно ограниченное восстановление reports/.

Источник ОБЯЗАН быть остановленным для записи (server и report-worker).
Программа не останавливает службы. Только restore-reports заменяет reports/
в остановленном источнике; остальные команды источник не изменяют. Согласование окна
и проверка quiescence остаются задачей вызывающего оператора.
Не публикуйте копии, манифесты и вывод с первичными данными в Git.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import stat
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


class BackupError(Exception):
    pass


def inventory(root: Path, *, require_complete: bool = True) -> dict[str, dict[str, object]]:
    if not root.is_dir() or root.is_symlink():
        raise BackupError("BACKUP_STATE_INCOMPLETE")
    result: dict[str, dict[str, object]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise BackupError("BACKUP_UNSAFE_FILE")
        metadata = path.stat()
        attributes = {"uid": metadata.st_uid, "gid": metadata.st_gid,
                      "mode": stat.S_IMODE(metadata.st_mode)}
        if path.is_dir():
            result[path.relative_to(root).as_posix() + "/"] = {
                **attributes, "kind": "directory", "bytes": 0}
            continue
        if not path.is_file() or not stat.S_ISREG(metadata.st_mode):
            raise BackupError("BACKUP_UNSAFE_FILE")
        digest = hashlib.sha256()
        size = 0
        with path.open("rb") as src:
            for block in iter(lambda: src.read(1024 * 1024), b""):
                digest.update(block)
                size += len(block)
        result[path.relative_to(root).as_posix()] = {
            **attributes, "sha256": digest.hexdigest(), "bytes": size}
    must_exist = {"aemr.db", "reports/inputs/registry.json", "reports/inputs/ledger.json"}
    if require_complete and not must_exist.issubset(result):
        raise BackupError("BACKUP_STATE_INCOMPLETE")
    if require_complete and not any(name.startswith("reports/published/") and name.endswith(".docx")
                                    for name in result):
        raise BackupError("BACKUP_STATE_INCOMPLETE")
    return result


def verify_restored_documents_and_sqlite(root: Path, files: dict) -> tuple[int, int]:
    dbs = 0
    documents = 0
    for rel in files:
        if rel.endswith("/"):
            continue
        path = root / rel
        if path.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
            try:
                with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
                    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                        raise BackupError("BACKUP_SQLITE_INVALID")
                dbs += 1
            except sqlite3.Error as exc:
                raise BackupError("BACKUP_SQLITE_INVALID") from exc
        elif path.suffix.lower() == ".docx":
            try:
                with zipfile.ZipFile(path) as archive:
                    if "word/document.xml" not in archive.namelist() or archive.testzip() is not None:
                        raise BackupError("BACKUP_DOCX_INVALID")
                documents += 1
            except (OSError, zipfile.BadZipFile) as exc:
                raise BackupError("BACKUP_DOCX_INVALID") from exc
    if dbs == 0 or documents == 0:
        raise BackupError("BACKUP_STATE_INCOMPLETE")
    return dbs, documents



def copy_with_ownership(source: Path, destination: Path) -> None:
    """Copy exact file contents and owner/mode; never operate on the source."""
    shutil.copytree(source, destination, symlinks=False, copy_function=shutil.copy2)
    if os.geteuid() == 0:
        # The production image runs this helper as root; a simple copytree
        # alone would silently turn all node-owned SQLite files root-owned.
        for original in [source, *source.rglob("*")]:
            target = destination / original.relative_to(source)
            metadata = original.stat()
            os.chown(target, metadata.st_uid, metadata.st_gid)


def check_nonoverlapping(source: Path, backup: Path) -> None:
    if source == backup or source in backup.parents or backup in source.parents:
        raise BackupError("BACKUP_PATH_OVERLAP")


def _archive_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _compress_state(source: Path, archive: Path, files: dict, max_bytes: int) -> None:
    """Stream a full copy; refuse to consume the caller's free-space reserve."""
    with archive.open("xb") as output:
        class BoundedOutput:
            def write(self, data):
                if output.tell() + len(data) > max_bytes:
                    raise BackupError("BACKUP_STORAGE_INSUFFICIENT")
                return output.write(data)

        with (gzip.GzipFile(fileobj=BoundedOutput(), mode="wb", mtime=0) as compressed,
              tarfile.open(fileobj=compressed, mode="w|", dereference=True) as stream):
            for relative in files:
                stream.add(source / relative, arcname=relative.rstrip("/"), recursive=False)
        output.flush()
        os.fsync(output.fileno())


def _checked_member(member, files, seen):
    path = Path(member.name)
    if (path.is_absolute() or ".." in path.parts or path.as_posix() != member.name
            or not path.parts or not (member.isfile() or member.isdir())):
        raise BackupError("BACKUP_UNSAFE_FILE")
    relative = member.name + ("/" if member.isdir() else "")
    info = files.get(relative)
    if relative in seen or not isinstance(info, dict):
        raise BackupError("BACKUP_MISMATCH")
    if ((info.get("kind") == "directory") != member.isdir()
            or member.size != info.get("bytes")
            or any(getattr(member, key) != info.get(key) for key in ("uid", "gid", "mode"))):
        raise BackupError("BACKUP_MISMATCH")
    seen.add(relative)
    return path, info


def _validate_archive_content(backup: Path, files: dict) -> None:
    """Validate every member before destructive scoped recovery, without extra disk."""
    seen = set()
    with tarfile.open(backup / "state.tar.gz", "r|gz") as stream:
        for member in stream:
            _, info = _checked_member(member, files, seen)
            if member.isfile():
                with stream.extractfile(member) as content:
                    if hashlib.file_digest(content, "sha256").hexdigest() != info.get('sha256'):
                        raise BackupError('BACKUP_MISMATCH')
    if seen != set(files):
        raise BackupError('BACKUP_MISMATCH')


def _restore_compressed(backup: Path, restored: Path, files: dict, *, reports_only=False) -> None:
    """Extract only expected regular files/directories; never use extractall."""
    if not reports_only:
        restored.mkdir(mode=0o700)
    seen = set()
    directories = []
    with tarfile.open(backup / "state.tar.gz", "r|gz") as stream:
        for member in stream:
            path, info = _checked_member(member, files, seen)
            if reports_only and path.parts[0] != 'reports':
                continue
            target = restored / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
                directories.append((target, info))
            else:
                with stream.extractfile(member) as src, target.open("xb") as destination:
                    shutil.copyfileobj(src, destination)
                os.chmod(target, info["mode"])
                if os.geteuid() == 0:
                    os.chown(target, info["uid"], info["gid"])
    if seen != set(files):
        raise BackupError("BACKUP_MISMATCH")
    for target, info in reversed(directories):
        os.chmod(target, info["mode"])
        if os.geteuid() == 0:
            os.chown(target, info["uid"], info["gid"])


def create(source: Path, backup: Path, *, compressed: bool = False) -> dict:
    source = source.resolve(strict=True)
    backup = backup.resolve(strict=False)
    check_nonoverlapping(source, backup)
    if backup.exists():
        raise BackupError("BACKUP_TARGET_EXISTS")
    if not backup.parent.is_dir():
        raise BackupError("BACKUP_DESTINATION_UNAVAILABLE")
    before = inventory(source)
    total = sum(int(row["bytes"]) for row in before.values())
    # Requires room for both the backup and its later independent scratch restore.
    free = shutil.disk_usage(backup.parent).free
    reserve = 128 * 1024 * 1024
    if free < (reserve if compressed else total * 2 + reserve):
        raise BackupError("BACKUP_STORAGE_INSUFFICIENT")
    staging = Path(tempfile.mkdtemp(prefix=".aemr-backup-", dir=backup.parent))
    try:
        if compressed:
            _compress_state(source, staging / "state.tar.gz", before, free - reserve)
        else:
            copy_with_ownership(source, staging / "state")
        if inventory(source) != before:
            raise BackupError("SOURCE_CHANGED_DURING_BACKUP")
        if not compressed and inventory(staging / "state") != before:
            raise BackupError("BACKUP_MISMATCH")
        # SQLite WAL may create a shared-memory sidecar even for a read. Run
        # integrity checks only on the disposable restore, never on the backup.
        manifest = {"format": 2 if compressed else 1, "files": before, "bytes": total}
        if compressed:
            manifest.update(archive_sha256=_archive_hash(staging / "state.tar.gz"),
                            archive_bytes=(staging / "state.tar.gz").stat().st_size)
        receipt = staging / "manifest.json"
        with receipt.open("x", encoding="utf-8") as stream:
            json.dump(manifest, stream, ensure_ascii=False, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        staging.rename(backup)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return {"state": "BACKUP_CREATED", "format": manifest["format"],
            "files": len(before), "bytes": total,
            **({"archive_bytes": manifest["archive_bytes"]} if compressed else {})}


def _validated_backup(backup: Path) -> tuple[dict, dict, int]:
    with (backup / "manifest.json").open(encoding="utf-8") as receipt:
        manifest = json.load(receipt)
    if manifest.get("format") not in (1, 2) or not isinstance(manifest.get("files"), dict):
        raise BackupError("BACKUP_MANIFEST_INVALID")
    files = manifest["files"]
    if any(not isinstance(row, dict) or type(row.get("bytes")) is not int
           or row["bytes"] < 0 for row in files.values()):
        raise BackupError("BACKUP_MANIFEST_INVALID")
    total = sum(row["bytes"] for row in files.values())
    if type(manifest.get("bytes")) is not int or total != manifest["bytes"]:
        raise BackupError("BACKUP_MISMATCH")
    if manifest["format"] == 2:
        archive = backup / "state.tar.gz"
        if archive.is_symlink() or not archive.is_file():
            raise BackupError("BACKUP_UNSAFE_FILE")
        if (archive.stat().st_size != manifest.get("archive_bytes")
                or _archive_hash(archive) != manifest.get("archive_sha256")):
            raise BackupError("BACKUP_MISMATCH")
    elif inventory(backup / "state") != files:
        raise BackupError("BACKUP_MISMATCH")
    return manifest, files, total


def match_source(backup: Path, source: Path) -> dict:
    """Check freshness after an independently executed external scratch restore.

    This is not a restore certificate or deployment authorization. The calling
    trusted workflow must already have completed verify() on the identical backup.
    """
    backup = backup.resolve(strict=True)
    source = source.resolve(strict=True)
    check_nonoverlapping(source, backup)
    _, files, total = _validated_backup(backup)
    if inventory(source) != files:
        raise BackupError('BACKUP_SOURCE_MISMATCH')
    return {'state': 'SOURCE_MATCHED_ONLY', 'files': len(files), 'bytes': total}


def _reports(files: dict) -> dict:
    return {key: value for key, value in files.items() if key.startswith('reports/')}


def match_reports(backup: Path, source: Path) -> dict:
    """Worker-only freshness; not authorization for a server/web/code release."""
    backup, source = backup.resolve(strict=True), source.resolve(strict=True)
    check_nonoverlapping(source, backup)
    _, files, _ = _validated_backup(backup)
    expected = _reports(files)
    if not expected or _reports(inventory(source, require_complete=False)) != expected:
        raise BackupError('BACKUP_REPORT_SCOPE_MISMATCH')
    return {'state': 'REPORT_SCOPE_MATCHED_ONLY', 'files': len(expected)}


def restore_reports(backup: Path, source: Path, verified_manifest_sha256: str) -> dict:
    """Restore ONLY worker state after full external restore of this exact manifest.

    Caller must quiesce both writers and obtain the digest from that trusted
    successful restore. No core SQLite or operational Dash snapshots are replaced.
    """
    backup, source = backup.resolve(strict=True), source.resolve(strict=True)
    check_nonoverlapping(source, backup)
    if _archive_hash(backup / 'manifest.json') != verified_manifest_sha256:
        raise BackupError('BACKUP_VERIFIED_MANIFEST_MISMATCH')
    manifest, files, _ = _validated_backup(backup)
    expected = _reports(files)
    required = {'reports/', 'reports/inputs/registry.json', 'reports/inputs/ledger.json'}
    if manifest['format'] != 2 or not required.issubset(expected):
        raise BackupError('BACKUP_STATE_INCOMPLETE')
    # The archive bytes, contents, paths and attributes all pass before deletion.
    _validate_archive_content(backup, files)
    before = inventory(source, require_complete=False)
    reports = source / 'reports'
    if reports.exists():
        shutil.rmtree(reports)
    _restore_compressed(backup, source, files, reports_only=True)
    after = inventory(source, require_complete=False)
    if _reports(after) != expected or {k: v for k, v in after.items() if not k.startswith('reports/')} != {
            k: v for k, v in before.items() if not k.startswith('reports/')}:
        raise BackupError('BACKUP_MISMATCH')
    dbs, documents = verify_restored_documents_and_sqlite(source, expected)
    return {'state': 'REPORT_SCOPE_RESTORED', 'files': len(expected),
            'sqlite_checked': dbs, 'docx_checked': documents, 'core_state_preserved': True}


def verify(backup: Path, scratch_parent: Path, source: Path | None = None, *, trial_report_restore=False) -> dict:
    backup = backup.resolve(strict=True)
    scratch_parent = scratch_parent.resolve(strict=True)
    if not scratch_parent.is_dir() or (backup == scratch_parent or backup in scratch_parent.parents):
        raise BackupError("BACKUP_PATH_OVERLAP")
    if source is not None:
        source = source.resolve(strict=True)
        check_nonoverlapping(source, backup)
        check_nonoverlapping(source, scratch_parent)
    manifest, files, total = _validated_backup(backup)
    if source is not None and inventory(source) != files:
        raise BackupError("BACKUP_SOURCE_MISMATCH")
    if shutil.disk_usage(scratch_parent).free < total + 128 * 1024 * 1024:
        raise BackupError("BACKUP_STORAGE_INSUFFICIENT")
    with tempfile.TemporaryDirectory(prefix="aemr-restore-", dir=scratch_parent) as scratch:
        restored = Path(scratch) / "state"
        if manifest["format"] == 2:
            _restore_compressed(backup, restored, files)
        else:
            copy_with_ownership(backup / "state", restored)
        if inventory(restored) != files:
            raise BackupError("BACKUP_MISMATCH")
        dbs, documents = verify_restored_documents_and_sqlite(restored, files)
        if trial_report_restore:
            # Same real archived report state, synthetic failed mutation only in scratch.
            # Full copy remains intact off-volume; no production/source writer is used.
            (restored / 'reports/inputs/ledger.json').write_text('synthetic failed worker update')
            failed = restored / 'reports/synthetic-failed-attempt'
            failed.mkdir()
            (failed / 'status.json').write_text('{"status":"NOT_ISSUED"}')
            (restored / 'core-preservation-proof').write_bytes(b'new core state')
            result = restore_reports(backup, restored, _archive_hash(backup / 'manifest.json'))
            if (result.get('core_state_preserved') is not True or failed.exists()
                    or (restored / 'core-preservation-proof').read_bytes() != b'new core state'):
                raise BackupError('BACKUP_WORKER_ROLLBACK_INVALID')
    # A release needs the current quiesced state, not merely a valid old copy.
    # Recheck after scratch recovery; never open production SQLite for a read
    # that could create WAL/SHM sidecars. Quiescence is enforced by the caller.
    if source is not None and inventory(source) != files:
        raise BackupError("SOURCE_CHANGED_DURING_BACKUP_VERIFICATION")
    result = {"state": "VERIFIED_IN_SCRATCH", "files": len(files),
              "bytes": total, "sqlite_checked": dbs, "docx_checked": documents}
    if trial_report_restore:
        result.update(worker_scope_rollback='PASS', manifest_sha256=_archive_hash(backup / 'manifest.json'))
    if source is not None:
        result["source_matched"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    write = sub.add_parser("create")
    write.add_argument("--source", type=Path, required=True)
    write.add_argument("--backup", type=Path, required=True)
    write.add_argument("--compressed", action="store_true",
                       help="Полная сжатая копия; восстановление может требовать другой диск")
    read = sub.add_parser("verify")
    read.add_argument("--backup", type=Path, required=True)
    read.add_argument("--scratch-parent", type=Path, required=True)
    read.add_argument('--trial-report-restore', action='store_true')
    read.add_argument("--source", type=Path,
                      help="Остановленный источник для проверки актуальности перед выпуском")
    match = sub.add_parser('match-source', help='Compare quiesced source with a backup; does not claim restore')
    match.add_argument('--backup', type=Path, required=True)
    match.add_argument('--source', type=Path, required=True)
    for command in ('match-reports', 'restore-reports'):
        scoped = sub.add_parser(command, help='Worker-only report-state operation, never full release')
        scoped.add_argument('--backup', type=Path, required=True)
        scoped.add_argument('--source', type=Path, required=True)
        if command == 'restore-reports':
            scoped.add_argument('--verified-manifest-sha256', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'create':
            result = create(args.source, args.backup, compressed=args.compressed)
        elif args.command == 'match-reports':
            result = match_reports(args.backup, args.source)
        elif args.command == 'restore-reports':
            result = restore_reports(args.backup, args.source, args.verified_manifest_sha256)
        elif args.command == 'match-source':
            result = match_source(args.backup, args.source)
        else:
            result = verify(args.backup, args.scratch_parent, args.source,
                            trial_report_restore=args.trial_report_restore)
        print(json.dumps(result, sort_keys=True))
        return 0
    except BackupError as exc:
        print(str(exc), file=sys.stderr)
    except (OSError, ValueError, json.JSONDecodeError, tarfile.TarError, EOFError):
        print("BACKUP_IO_OR_MANIFEST_FAILED", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
