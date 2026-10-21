from __future__ import annotations

import hashlib
import json

from .normalize import clean_text

# Reviewed title migrations share the immutable book/sheet identity. Readers
# and formula closure must use the same aliases without rewriting old captures.
APPROVED_PRIMARY_TITLE_ALIASES = {
    ('14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ', 1575754193, 'УФБП'): 'УФ',
    ('1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4', 1697519059, 'УДТХ'): 'УДТХиБ',
}


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


def registry_grbs_order(registry: dict) -> list[str]:
    """Explicit reporting perimeter; missing inputs never redefine that perimeter.

    The original eight-department contract remains the backward-compatible default.
    A different perimeter is a versioned private input, not a source-code edit.
    """
    from .constants import GRBS_ORDER

    order = registry.get('grbs_order', GRBS_ORDER)
    if (not isinstance(order, list) or not order
        or any(not isinstance(value, str) or not value or clean_text(value) != value for value in order)
        or len(set(order)) != len(order)):
        raise ValueError('INPUT_GRBS_ORDER_INVALID')
    return list(order)
