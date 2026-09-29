from __future__ import annotations

import hashlib
import json

from .normalize import clean_text


def schema_fingerprint(header_rows: list[list], *, max_rows: int = 4, max_cols: int = 34) -> str:
    """Stable fingerprint of the header/schema area, independent of incidental whitespace."""
    normalized = []
    for row in header_rows[:max_rows]:
        normalized.append([clean_text(x).casefold() for x in row[:max_cols]])
    payload = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_schema_fingerprint(actual: str, allowed: list[str]) -> None:
    if actual not in set(allowed):
        raise ValueError(f"SOURCE_SCHEMA_CHANGED: fingerprint={actual}")
