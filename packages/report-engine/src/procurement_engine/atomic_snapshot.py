from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable

from .models import ValidationIssue
from .snapshot import _snapshot_id, canonical_semantic_hash


class AtomicSnapshotError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourcePayload:
    source_id: str
    role: str
    provider_id: str
    semantic_values: Any
    sheet_or_tab_id: str | None = None
    schema_fingerprint: str | None = None
    raw_content_hash: str | None = None
    metadata: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["canonical_semantic_hash"] = canonical_semantic_hash(self.semantic_values)
        return d


@runtime_checkable
class SnapshotSourceAdapter(Protocol):
    source_id: str
    role: str
    provider_id: str

    def revision_token(self) -> str | None:
        """Return a stable revision/modified-time/change token without reading business data."""
        ...

    def read_payload(self) -> SourcePayload:
        """Read the complete configured semantic payload for this source role."""
        ...

    @property
    def allowed_schema_fingerprints(self) -> Sequence[str]:
        ...


@dataclass(frozen=True)
class AtomicSnapshotBundle:
    manifest: dict[str, Any]
    payloads: tuple[SourcePayload, ...]
    attempt: int
    before: dict[str, str | None]
    after: dict[str, str | None]

    def as_dict(self) -> dict[str, Any]:
        return {
            "manifest": self.manifest,
            "payloads": [x.as_dict() for x in self.payloads],
            "attempt": self.attempt,
            "before": dict(self.before),
            "after": dict(self.after),
        }


def _validate_adapters(adapters: Sequence[SnapshotSourceAdapter]) -> None:
    ids = [a.source_id for a in adapters]
    if not adapters:
        raise AtomicSnapshotError("ATOMIC_SNAPSHOT_NO_SOURCES")
    if len(ids) != len(set(ids)):
        raise AtomicSnapshotError("ATOMIC_SNAPSHOT_DUPLICATE_SOURCE_ID")
    for a in adapters:
        if not a.source_id or not a.role or not a.provider_id:
            raise AtomicSnapshotError(f"ATOMIC_SOURCE_IDENTITY_INCOMPLETE:{getattr(a, 'source_id', '')}")


def _read_revision_map(adapters: Sequence[SnapshotSourceAdapter]) -> dict[str, str | None]:
    return {a.source_id: a.revision_token() for a in adapters}


def _validate_payload(adapter: SnapshotSourceAdapter, payload: SourcePayload) -> None:
    if payload.source_id != adapter.source_id:
        raise AtomicSnapshotError(f"SOURCE_PAYLOAD_ID_MISMATCH:{adapter.source_id}:{payload.source_id}")
    if payload.provider_id != adapter.provider_id:
        raise AtomicSnapshotError(f"SOURCE_PROVIDER_ID_MISMATCH:{adapter.source_id}")
    if payload.role != adapter.role:
        raise AtomicSnapshotError(f"SOURCE_ROLE_MISMATCH:{adapter.source_id}")
    allowed = tuple(getattr(adapter, "allowed_schema_fingerprints", ()) or ())
    if allowed and (not payload.schema_fingerprint or payload.schema_fingerprint not in set(allowed)):
        raise AtomicSnapshotError(f"SOURCE_SCHEMA_CHANGED:{adapter.source_id}:{payload.schema_fingerprint}")


def capture_atomic_snapshot(adapters: Sequence[SnapshotSourceAdapter], *, report_date: str, report_year: int,
                            rules_version: str, renderer_version: str, mode: str = "CANONICAL",
                            cutoff_at: str | None = None, max_attempts: int = 3,
                            require_revision: bool = True) -> AtomicSnapshotBundle:
    """Capture all sources under one revision barrier.

    The whole read is discarded and retried if *any* source changes between the global BEFORE
    and AFTER metadata barriers. No renderer or metric code should call adapters after this function.
    """
    if mode not in {"CANONICAL", "FORENSIC_REPLAY"}:
        raise AtomicSnapshotError("ATOMIC_SNAPSHOT_MODE_INVALID")
    if max_attempts < 1:
        raise ValueError("max_attempts must be >= 1")
    _validate_adapters(adapters)
    last_drift: tuple[dict[str, str | None], dict[str, str | None]] | None = None
    for attempt in range(1, max_attempts + 1):
        before = _read_revision_map(adapters)
        if require_revision:
            missing_revision = [source_id for source_id, token in before.items() if token is None]
            if missing_revision:
                raise AtomicSnapshotError(f"ATOMIC_SOURCE_REVISION_UNAVAILABLE:{','.join(sorted(missing_revision))}")
        payloads: list[SourcePayload] = []
        for adapter in adapters:
            payload = adapter.read_payload()
            _validate_payload(adapter, payload)
            payloads.append(payload)
        after = _read_revision_map(adapters)
        if before != after:
            last_drift = (before, after)
            continue

        captured_at = cutoff_at or datetime.now(timezone.utc).isoformat()
        sources = []
        for payload in payloads:
            semantic_hash = canonical_semantic_hash(payload.semantic_values)
            sources.append({
                "source_id": payload.source_id,
                "role": payload.role,
                "provider_id": payload.provider_id,
                "sheet_or_tab_id": payload.sheet_or_tab_id,
                "schema_fingerprint": payload.schema_fingerprint,
                "revision_or_modified_at": after[payload.source_id],
                "revision_or_modified_time_before": before[payload.source_id],
                "revision_or_modified_time_after": after[payload.source_id],
                "capture_timestamp": captured_at,
                "content_hash": payload.raw_content_hash or semantic_hash,
                "canonical_semantic_hash": semantic_hash,
                "content_hash_kind": "raw" if payload.raw_content_hash else "canonical_semantic_values",
                "payload_metadata": dict(payload.metadata or {}),
            })
        sid = _snapshot_id(
            report_date=report_date, report_year=report_year, sources=sources,
            rules_version=rules_version, renderer_version=renderer_version, mode=mode,
        )
        manifest = {
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
            "snapshot_contract_version": "snapshot-v2.2.0",
            "atomic_capture": {"attempt": attempt, "before_after_equal": True},
        }
        return AtomicSnapshotBundle(manifest, tuple(payloads), attempt, before, after)

    before, after = last_drift or ({}, {})
    changed = [k for k in sorted(set(before) | set(after)) if before.get(k) != after.get(k)]
    raise AtomicSnapshotError(f"SOURCE_CHANGED_DURING_FREEZE:{','.join(changed)}")


def validate_at_publish(adapters: Sequence[SnapshotSourceAdapter], frozen_after: dict[str, str | None]) -> list[ValidationIssue]:
    """AT_PUBLISH revision barrier. Caller must rebuild instead of publishing on any error."""
    current = _read_revision_map(adapters)
    issues: list[ValidationIssue] = []
    for source_id in sorted(set(frozen_after) | set(current)):
        if frozen_after.get(source_id) != current.get(source_id):
            issues.append(ValidationIssue(
                "ERROR", "SOURCE_CHANGED_AFTER_FREEZE",
                f"{source_id}: source changed after atomic snapshot and before publication",
                {"frozen_after": frozen_after.get(source_id), "at_publish": current.get(source_id)},
            ))
    return issues
