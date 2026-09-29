from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .atomic_snapshot import AtomicSnapshotBundle
from .snapshot import canonical_semantic_hash


def schema_fingerprint_from_matrix(values: list[list[Any]], *, header_rows: int = 3) -> str:
    """Fingerprint the semantic header contract, independent of row data."""
    header = [list(row) for row in values[:header_rows]]
    return canonical_semantic_hash(header)


def matrix_shape(values: Any) -> dict[str, int]:
    if not isinstance(values, list):
        return {"rows": 0, "max_columns": 0}
    return {
        "rows": len(values),
        "max_columns": max((len(row) for row in values if isinstance(row, list)), default=0),
    }


def persist_atomic_bundle(bundle: AtomicSnapshotBundle, directory: str | Path) -> dict[str, Any]:
    """Persist an immutable semantic snapshot bundle with per-payload checksums.

    Raw provider bytes may be unavailable for native cloud sheets. The canonical value-matrix JSON
    is therefore always persisted and hashed; a raw_content_hash remains additive evidence when the
    provider adapter can supply it.
    """
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    payload_dir = root / "payloads"
    payload_dir.mkdir(exist_ok=True)

    payload_index: list[dict[str, Any]] = []
    for payload in bundle.payloads:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in payload.source_id)
        path = payload_dir / f"{safe}.json"
        body = {
            "source_id": payload.source_id,
            "role": payload.role,
            "provider_id": payload.provider_id,
            "sheet_or_tab_id": payload.sheet_or_tab_id,
            "schema_fingerprint": payload.schema_fingerprint,
            "raw_content_hash": payload.raw_content_hash,
            "metadata": payload.metadata or {},
            "semantic_values": payload.semantic_values,
        }
        encoded = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
        path.write_bytes(encoded)
        payload_index.append({
            "source_id": payload.source_id,
            "path": str(path.relative_to(root)),
            "bundle_file_sha256": hashlib.sha256(encoded).hexdigest(),
            "canonical_semantic_hash": canonical_semantic_hash(payload.semantic_values),
            "shape": matrix_shape(payload.semantic_values),
        })

    manifest = dict(bundle.manifest)
    manifest["payload_index"] = payload_index
    manifest_path = root / "manifest.json"
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2, default=str).encode("utf-8")
    manifest_path.write_bytes(manifest_bytes)

    bundle_meta = {
        "snapshot_id": manifest["snapshot_id"],
        "attempt": bundle.attempt,
        "before": bundle.before,
        "after": bundle.after,
        "manifest_path": "manifest.json",
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "payload_count": len(payload_index),
    }
    meta_path = root / "bundle.json"
    meta_path.write_text(json.dumps(bundle_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return bundle_meta


def verify_persisted_bundle(directory: str | Path) -> list[str]:
    root = Path(directory)
    errors: list[str] = []
    manifest_path = root / "manifest.json"
    meta_path = root / "bundle.json"
    if not manifest_path.exists() or not meta_path.exists():
        return ["SNAPSHOT_BUNDLE_MANIFEST_MISSING"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    got_manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    if got_manifest_sha != meta.get("manifest_sha256"):
        errors.append("SNAPSHOT_BUNDLE_MANIFEST_HASH_MISMATCH")
    if manifest.get("snapshot_id") != meta.get("snapshot_id"):
        errors.append("SNAPSHOT_BUNDLE_ID_MISMATCH")
    for item in manifest.get("payload_index", []):
        path = root / item["path"]
        if not path.exists():
            errors.append(f"SNAPSHOT_PAYLOAD_MISSING:{item['source_id']}")
            continue
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item.get("bundle_file_sha256"):
            errors.append(f"SNAPSHOT_PAYLOAD_FILE_HASH_MISMATCH:{item['source_id']}")
            continue
        body = json.loads(raw.decode("utf-8"))
        if canonical_semantic_hash(body.get("semantic_values")) != item.get("canonical_semantic_hash"):
            errors.append(f"SNAPSHOT_PAYLOAD_SEMANTIC_HASH_MISMATCH:{item['source_id']}")
    return errors
