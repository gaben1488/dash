from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class SourceRef:
    source_id: str
    role: str
    provider_id: str
    revision_or_modified_at: str | None = None
    content_hash: str | None = None


@dataclass(frozen=True)
class ProcurementRow:
    snapshot_id: str
    procurement_id: str
    grbs: str
    subject: str
    method: str | None
    institution: str = ""
    activity_kind: str = ""
    source_row_no: str | None = None
    planned_date: str | None = None
    planned_quarter: int | None = None
    planned_year: int | None = None
    actual_date: str | None = None
    plan_fb: float = 0.0
    plan_kb: float = 0.0
    plan_mb: float = 0.0
    stored_plan_total: float | None = None
    fact_fb: float = 0.0
    fact_kb: float = 0.0
    fact_mb: float = 0.0
    stored_fact_total: float | None = None
    saving_fb: float = 0.0
    saving_kb: float = 0.0
    saving_mb: float = 0.0
    stored_saving_total: float | None = None
    include_saving: bool | None = None
    program: str = ""
    subprogram: str = ""
    single_supplier_reason: str = ""
    necessity_reason: str = ""
    uer_comment: str = ""
    deviation_reason: str = ""
    grbs_comment: str = ""
    procedure_code: str = ""
    monitoring_note: str = ""
    source_id: str = ""
    sheet_name: str = ""
    row_number: int | None = None
    procurement_uid: str | None = None
    missing_money_fields: tuple[str, ...] = ()

    @property
    def plan_total(self) -> float:
        return self.plan_fb + self.plan_kb + self.plan_mb

    @property
    def fact_total(self) -> float:
        return self.fact_fb + self.fact_kb + self.fact_mb

    @property
    def saving_total(self) -> float:
        return self.saving_fb + self.saving_kb + self.saving_mb

    @property
    def has_recorded_fact(self) -> bool:
        return bool(self.actual_date)

    @property
    def has_monetary_fact(self) -> bool:
        return abs(self.fact_total) > 1e-9

    @property
    def stable_identity_key(self) -> str | None:
        return self.procurement_uid or self.physical_row_key

    @property
    def physical_row_key(self) -> str | None:
        if not (self.source_id and self.sheet_name and self.row_number is not None):
            return None
        return f"{self.source_id}::{self.sheet_name}::{self.row_number}::{self.procurement_id}"


@dataclass(frozen=True)
class OperationalEvent:
    event_id: str
    procurement_id: str
    event_type: str
    occurred_at: str
    recorded_at: str | None
    source_kind: str
    source_ref: str
    confidence: float = 1.0
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProcedureBinding:
    procurement_id: str
    procedure_code: str
    reliable: bool
    subject_similarity: float | None = None
    reason: str = ""


@dataclass(frozen=True)
class IdentityEdge:
    source_id: str
    target_id: str
    relation: str
    evidence: str
    confidence: float = 1.0


@dataclass
class ValidationIssue:
    severity: str
    code: str
    message: str
    context: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ProcedureAttempt:
    procedure_code: str
    grbs: str
    customer: str
    subject: str
    nmc: float
    stage: str
    result: str = ""
    final_price: float | None = None
    ancestor_code: str | None = None
    successor_code: str | None = None
    source_ref: str = ""


@dataclass(frozen=True)
class ProcedureShare:
    procedure_code: str
    grbs: str
    amount: float
    source_ref: str = ""


@dataclass(frozen=True)
class ReviewedBinding:
    procurement_row_key: str
    procedure_code: str
    decision: str
    reviewed_by: str
    reviewed_at: str
    evidence: dict[str, Any] = field(default_factory=dict)
