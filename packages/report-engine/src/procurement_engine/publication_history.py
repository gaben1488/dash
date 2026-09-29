from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class PublicationRecord:
    snapshot_id: str
    report_date: str
    published_at: str
    status: str = "PUBLISHED"
    official: bool = True
    mode: str = "CANONICAL"
    rules_version: str = ""
    renderer_version: str = ""
    artifact_ids: tuple[str, ...] = ()
    diagnostic: bool = False

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _date_key(value: str) -> datetime:
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)  # noqa: DTZ007 — civil report date, not an instant.
        except ValueError:
            pass
    raise ValueError(f"Unsupported report_date: {value}")


def _published_key(value: str) -> str:
    # ISO timestamps sort lexicographically. Keep a deterministic fallback for legacy rows.
    return value or ""


def is_official_publication(record: PublicationRecord | dict) -> bool:
    r = record if isinstance(record, PublicationRecord) else PublicationRecord(**record)
    return bool(r.official and not r.diagnostic and r.status == "PUBLISHED" and r.mode == "CANONICAL")


def select_previous_official(records: Iterable[PublicationRecord | dict], *, current_report_date: str,
                             current_snapshot_id: str | None = None) -> PublicationRecord | None:
    current_date = _date_key(current_report_date)
    candidates: list[PublicationRecord] = []
    for raw in records:
        r = raw if isinstance(raw, PublicationRecord) else PublicationRecord(**raw)
        if current_snapshot_id and r.snapshot_id == current_snapshot_id:
            continue
        if not is_official_publication(r):
            continue
        if _date_key(r.report_date) >= current_date:
            continue
        candidates.append(r)
    if not candidates:
        return None
    candidates.sort(key=lambda r: (_date_key(r.report_date), _published_key(r.published_at), r.snapshot_id))
    return candidates[-1]


def compare_published_models(current: dict, previous: dict | None) -> dict:
    """Compare recorded totals, never infer procurement events from aggregate deltas."""
    result = {'status': 'FIRST_RELEASE', 'changes': [], 'compared_periods': []}
    if previous is None:
        return result
    current_meta = current['snapshot']; previous_meta = previous['snapshot']
    result.update(previous_snapshot_id=previous_meta['snapshot_id'], previous_report_date=previous_meta['report_date'])
    if current_meta['rules_version'] != previous_meta['rules_version']:
        result['status'] = 'RULES_CHANGED'
        return result
    if current_meta['report_year'] != previous_meta.get('report_year'):
        result['status'] = 'REPORT_YEAR_CHANGED'
        return result
    periods = ['year']
    if current['headline']['current_quarter'] == previous['headline']['current_quarter']:
        periods.append('quarter')
    result.update(status='COMPARABLE', compared_periods=periods)
    for kind in ('competitive', 'single_supplier'):
        for period in periods:
            a = previous['exact_metrics'][kind][period]; b = current['exact_metrics'][kind][period]
            for field in ('plan_count', 'fact_count', 'remain_count', 'plan_amount', 'fact_amount', 'remain_amount'):
                old = a[field] if field.endswith('_count') else a['exact_decimal'][field]
                new = b[field] if field.endswith('_count') else b['exact_decimal'][field]
                delta = Decimal(str(new)) - Decimal(str(old))
                if delta:
                    result['changes'].append({'kind': kind, 'period': period, 'field': field,
                        'before': old, 'after': new, 'delta': str(delta)})
    return result
