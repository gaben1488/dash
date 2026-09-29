from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

from .models import ProcurementRow
from .rule_catalog import DEFAULT_RULE_CATALOG


@dataclass(frozen=True)
class FactMetrics:
    plan_count: int = 0
    completed_position_count: int = 0
    plan_amount: float = 0.0
    completed_position_amount: float = 0.0
    monetary_fact_amount: float = 0.0
    partial_fact_without_completion_count: int = 0
    partial_fact_without_completion_amount: float = 0.0
    procedure_count: int | None = None
    contract_count: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def is_procurement_row(r: ProcurementRow, *, report_year: int | None = None) -> bool:
    """Compatibility wrapper around the versioned canonical RuleCatalog."""
    return DEFAULT_RULE_CATALOG.is_procurement_row(r, report_year=report_year)


def derive_fact_metrics(rows: Iterable[ProcurementRow], *, report_year: int, method: str | None = None,
                        planned_quarter: int | None = None) -> FactMetrics:
    plan_count = completed = partial_n = 0
    plan_amount = completed_amount = monetary = partial_amount = 0.0
    for r in rows:
        if not is_procurement_row(r, report_year=report_year):
            continue
        if method and r.method != method:
            continue
        if planned_quarter is not None and r.planned_quarter != planned_quarter:
            continue
        plan_count += 1
        plan_amount += r.plan_total
        monetary += r.fact_total
        if r.actual_date:
            completed += 1
            completed_amount += r.fact_total
        elif r.fact_total > 0.00001:
            partial_n += 1
            partial_amount += r.fact_total
    return FactMetrics(plan_count, completed, plan_amount, completed_amount, monetary, partial_n, partial_amount)


def attach_operational_counts(metrics: FactMetrics, *, procedure_count: int | None = None,
                              contract_count: int | None = None) -> FactMetrics:
    """Attach independently sourced operational counts without aliasing them to plan positions.

    ``None`` means the corresponding source was not available/authoritative. It must not be
    rendered as zero.
    """
    return FactMetrics(
        plan_count=metrics.plan_count,
        completed_position_count=metrics.completed_position_count,
        plan_amount=metrics.plan_amount,
        completed_position_amount=metrics.completed_position_amount,
        monetary_fact_amount=metrics.monetary_fact_amount,
        partial_fact_without_completion_count=metrics.partial_fact_without_completion_count,
        partial_fact_without_completion_amount=metrics.partial_fact_without_completion_amount,
        procedure_count=procedure_count,
        contract_count=contract_count,
    )
