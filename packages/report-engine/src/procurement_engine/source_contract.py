from __future__ import annotations

import hashlib
import json

# Compatibility export: this name is part of the legacy public API.
from .department_directory import APPROVED_PRIMARY_TITLE_ALIASES  # noqa: F401
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


def master_source_profile():
    """The reviewed 34-column contract shared with TypeScript, never a second schema."""
    from .department_directory import MASTER_SOURCE_PROFILE
    return MASTER_SOURCE_PROFILE


def validate_master_profile_layout(profile=None):
    """Reject drift in field positions, units, required meanings and dependencies."""
    profile = master_source_profile() if profile is None else profile
    if profile.get('id') != 'master-v1' or profile.get('role') != 'master' or profile.get('columns') != 34:
        raise ValueError('MASTER_PROFILE_LAYOUT_INVALID')
    fields = profile.get('fields')
    if not isinstance(fields, dict) or len(fields) != 34:
        raise ValueError('MASTER_PROFILE_LAYOUT_INVALID')
    by_key = set(fields)
    for key, field in fields.items():
        index = field.get('index')
        if (type(index) is not int or index < 0 or index >= 34
            or field.get('column') != _column_name(index)
            or field.get('kind') not in {'text', 'money', 'date', 'flag', 'integer', 'number', 'percent'}
            or field.get('unit') not in {'none', 'thousandRub', 'rub', 'percent', 'fraction', 'date'}
            or (field.get('kind') == 'money' and field.get('unit') not in {'thousandRub', 'rub'})
            or (field.get('kind') == 'date' and field.get('unit') not in {'date', 'none'})
            or (field.get('kind') == 'text' and field.get('unit') != 'none')
            or type(field.get('requiredMeaning')) is not bool
            or not isinstance(field.get('modelField'), str) or not field['modelField']
            or (field['requiredMeaning'] and not field.get('headerProbe'))):
            raise ValueError('MASTER_PROFILE_LAYOUT_INVALID:' + key)
        dependencies = field.get('dependsOn', [])
        if not isinstance(dependencies, list) or any(dep not in by_key or dep == key for dep in dependencies):
            raise ValueError('MASTER_PROFILE_DEPENDENCY_INVALID:' + key)
    if sorted(field['index'] for field in fields.values()) != list(range(34)):
        raise ValueError('MASTER_PROFILE_LAYOUT_INVALID')
    return profile


def _column_name(index):
    result = ''
    while index >= 0:
        index, digit = divmod(index, 26)
        result = chr(65 + digit) + result
        index -= 1
    return result
