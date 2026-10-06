from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class MetricBlock:
    plan_count: int
    fact_count: int
    remain_count: int
    plan_amount: float
    fact_amount: float
    remain_amount: float

    @property
    def execution_pct(self) -> float | None:
        return None if self.plan_count == 0 else 100.0 * self.fact_count / self.plan_count

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["execution_pct"] = self.execution_pct
        return d


def current_quarter(report_date: str) -> int:
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            month = datetime.strptime(report_date, fmt).month  # noqa: DTZ007 — civil report date, not an instant.
            return (month - 1) // 3 + 1
        except ValueError:
            pass
    raise ValueError(f"Unsupported report date: {report_date}")


def reporting_quarter(record: dict) -> int:
    """Selected plan quarter is independent of the immutable evidence cutoff."""
    scope = record.get('report_scope')
    if scope is None:
        return current_quarter(record['report_date'])
    if (not isinstance(scope, dict) or set(scope) != {'year', 'quarter'}
            or type(scope['year']) is not int or not 1900 <= scope['year'] <= 9999
            or type(scope['quarter']) is not int or scope['quarter'] not in (1, 2, 3, 4)
            or scope['year'] != record.get('report_year')):
        raise ValueError('REPORT_SCOPE_INVALID')
    return scope['quarter']


def aggregate_snapshot_model(model: dict, procurement_type: str, scope: str) -> MetricBlock:
    items = [g[procurement_type][scope] for g in model.values()]
    return MetricBlock(
        plan_count=sum(int(x["plan_count"]) for x in items),
        fact_count=sum(int(x["fact_count"]) for x in items),
        remain_count=sum(int(x["remain_count"]) for x in items),
        plan_amount=float(sum((Decimal(str(x['plan'].get('K_decimal',x['plan']['K']))) for x in items),Decimal(0))),
        fact_amount=float(sum((Decimal(str(x['fact'].get('Y_decimal',x['fact']['Y']))) for x in items),Decimal(0))),
        remain_amount=float(sum((Decimal(str(x['remain'].get('K_decimal',x['remain']['K']))) for x in items),Decimal(0))),
    )


def headline_from_snapshot(snapshot: dict) -> dict:
    q = reporting_quarter(snapshot)
    model = snapshot["model"]
    return {
        "report_date": snapshot["report_date"],
        "current_quarter": q,
        "competitive": {
            "year": aggregate_snapshot_model(model, "comp", "year").as_dict(),
            "quarter": aggregate_snapshot_model(model, "comp", f"q{q}").as_dict(),
        },
        "single_supplier": {
            "year": aggregate_snapshot_model(model, "ep", "year").as_dict(),
            "quarter": aggregate_snapshot_model(model, "ep", f"q{q}").as_dict(),
        },
    }
