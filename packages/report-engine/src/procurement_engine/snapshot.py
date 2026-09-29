from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()



def canonical_semantic_hash(value) -> str:
    """Hash canonical JSON/value-matrix content independently of XLSX zip bytes."""
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _snapshot_id(*, report_date: str, report_year: int, sources: list[dict], rules_version: str,
                 renderer_version: str, mode: str) -> str:
    payload = {
        "report_date": report_date,
        "report_year": report_year,
        "sources": sorted(
            [dict(
                {"source_id": x["source_id"], "provider_id": x.get("provider_id"),
                 "revision_or_modified_at": x.get("revision_or_modified_at"), "content_hash": x["content_hash"]},
                **({"canonical_semantic_hash": x["canonical_semantic_hash"]} if x.get("canonical_semantic_hash") else {}),
            ) for x in sources],
            key=lambda x: x["source_id"],
        ),
        "rules_version": rules_version,
        "renderer_version": renderer_version,
        "mode": mode,
    }
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return f"SNP-{digest[:20]}"


def freeze_manifest(*, report_date: str, report_year: int, source_files: list[dict],
                    rules_version: str, renderer_version: str, mode: str = "CANONICAL",
                    cutoff_at: str | None = None) -> dict:
    """Freeze a deterministic source manifest.

    `snapshot_id` depends only on report date, source revisions/hashes and code/rules versions. Runtime capture time is
    stored separately so two builds from identical evidence have the same identity.
    """
    if mode not in {"CANONICAL", "FORENSIC_REPLAY"}:
        raise ValueError("mode must be CANONICAL or FORENSIC_REPLAY")
    captured_at = cutoff_at or datetime.now(timezone.utc).isoformat()
    sources = []
    for spec in source_files:
        p = Path(spec["path"])
        content_hash = sha256_file(p)
        semantic_hash = spec.get("canonical_semantic_hash")
        if semantic_hash is None and "semantic_values" in spec:
            semantic_hash = canonical_semantic_hash(spec["semantic_values"])
        sources.append({
            "source_id": spec["source_id"],
            "role": spec["role"],
            "provider_id": spec.get("provider_id"),
            "sheet_or_tab_id": spec.get("sheet_or_tab_id"),
            "schema_fingerprint": spec.get("schema_fingerprint"),
            "revision_or_modified_at": spec.get("revision_or_modified_at"),
            "revision_or_modified_time_before": spec.get("revision_or_modified_time_before") or spec.get("revision_or_modified_at"),
            "revision_or_modified_time_after": spec.get("revision_or_modified_time_after") or spec.get("revision_or_modified_at"),
            "capture_timestamp": spec.get("capture_timestamp") or captured_at,
            "local_path": str(p),
            "content_hash": content_hash,
            "canonical_semantic_hash": semantic_hash or content_hash,
        })
    sid = _snapshot_id(report_date=report_date, report_year=report_year, sources=sources,
                       rules_version=rules_version, renderer_version=renderer_version, mode=mode)
    return {
        "snapshot_id": sid,
        "captured_at": captured_at,
        "cutoff_at": captured_at,
        "report_date": report_date,
        "report_year": report_year,
        "status": "FROZEN",
        "sources": sources,
        "rules_version": rules_version,
        "renderer_version": renderer_version,
        "mode": mode,
        "snapshot_contract_version": "snapshot-v2.1.0",
    }


def dump_json(data: dict | list, path: str | Path) -> None:
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
