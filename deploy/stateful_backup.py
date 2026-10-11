#!/usr/bin/env python3
"""Проверяемая копия всего server_data с восстановлением только в изолированном каталоге.

Источник ОБЯЗАН быть остановленным для записи (server и report-worker).
Программа не останавливает службы и не пишет в источник. Согласование окна
и проверка quiescence остаются задачей вызывающего оператора.
Не публикуйте копии, манифесты и вывод с первичными данными в Git.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import sys
import tempfile
import zipfile


class BackupError(Exception):
    pass


def inventory(root: Path) -> dict[str, dict[str, object]]:
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
    if not must_exist.issubset(result):
        raise BackupError("BACKUP_STATE_INCOMPLETE")
    if not any(name.startswith("reports/published/") and name.endswith(".docx")
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


def create(source: Path, backup: Path) -> dict:
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
    if shutil.disk_usage(backup.parent).free < total * 2 + 128 * 1024 * 1024:
        raise BackupError("BACKUP_STORAGE_INSUFFICIENT")
    staging = Path(tempfile.mkdtemp(prefix=".aemr-backup-", dir=backup.parent))
    try:
        copy_with_ownership(source, staging / "state")
        if inventory(source) != before:
            raise BackupError("SOURCE_CHANGED_DURING_BACKUP")
        if inventory(staging / "state") != before:
            raise BackupError("BACKUP_MISMATCH")
        # SQLite WAL may create a shared-memory sidecar even for a read. Run
        # integrity checks only on the disposable restore, never on the backup.
        manifest = {"format": 1, "files": before, "bytes": total}
        receipt = staging / "manifest.json"
        with receipt.open("x", encoding="utf-8") as stream:
            json.dump(manifest, stream, ensure_ascii=False, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        staging.rename(backup)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return {"state": "BACKUP_CREATED", "files": len(before), "bytes": total}


def verify(backup: Path, scratch_parent: Path) -> dict:
    backup = backup.resolve(strict=True)
    scratch_parent = scratch_parent.resolve(strict=True)
    if not scratch_parent.is_dir() or (backup == scratch_parent or backup in scratch_parent.parents):
        raise BackupError("BACKUP_PATH_OVERLAP")
    with (backup / "manifest.json").open(encoding="utf-8") as source:
        manifest = json.load(source)
    if manifest.get("format") != 1 or not isinstance(manifest.get("files"), dict):
        raise BackupError("BACKUP_MANIFEST_INVALID")
    files = manifest["files"]
    if inventory(backup / "state") != files:
        raise BackupError("BACKUP_MISMATCH")
    with tempfile.TemporaryDirectory(prefix="aemr-restore-", dir=scratch_parent) as scratch:
        restored = Path(scratch) / "state"
        copy_with_ownership(backup / "state", restored)
        if inventory(restored) != files:
            raise BackupError("BACKUP_MISMATCH")
        dbs, documents = verify_restored_documents_and_sqlite(restored, files)
    total = sum(int(row["bytes"]) for row in files.values())
    if total != manifest.get("bytes"):
        raise BackupError("BACKUP_MISMATCH")
    return {"state": "VERIFIED_IN_SCRATCH", "files": len(files),
            "bytes": total, "sqlite_checked": dbs, "docx_checked": documents}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    write = sub.add_parser("create")
    write.add_argument("--source", type=Path, required=True)
    write.add_argument("--backup", type=Path, required=True)
    read = sub.add_parser("verify")
    read.add_argument("--backup", type=Path, required=True)
    read.add_argument("--scratch-parent", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = (create(args.source, args.backup) if args.command == "create"
                  else verify(args.backup, args.scratch_parent))
        print(json.dumps(result, sort_keys=True))
        return 0
    except BackupError as exc:
        print(str(exc), file=sys.stderr)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("BACKUP_IO_OR_MANIFEST_FAILED", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
