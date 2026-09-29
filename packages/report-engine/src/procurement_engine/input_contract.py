from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

from .models import ValidationIssue

# Sources whose absence makes a complete canonical report impossible.
MANDATORY_MASTER_SOURCES = ("UER", "UIO", "UAGZO", "UFBP", "UD", "UDTX", "UKSIMP", "UO")
MANDATORY_CORE_SOURCES = MANDATORY_MASTER_SOURCES + ("PROCEDURES", "RECOMMENDATIONS", "IDENTITY_RELATIONS", "RULES")

# Capabilities required only when the report makes the corresponding claims.
CLAIM_CAPABILITIES = {
    "contract_count": "CONTRACT_REGISTER",
    "all_ep_completion": "CONTRACT_REGISTER_OR_STRUCTURED_EP_EVENTS",
    "monthly_2027": "STRUCTURED_FUTURE_PLAN_PERIOD",
    "current_recommendation_semantics": "CURRENT_RECOMMENDATION_EVENTS",
    "atomic_live_release": "SOURCE_REVISION_METADATA",
}

@dataclass(frozen=True)
class InputContractResult:
    complete: bool
    missing_sources: tuple[str, ...]
    missing_capabilities: tuple[str, ...]
    unresolved_critical_items: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_input_contract(*,
                            available_sources: Iterable[str],
                            available_capabilities: Iterable[str] = (),
                            requested_claims: Iterable[str] = (),
                            unresolved_critical_items: Iterable[str] = (),
                            require_core_sources: bool = True) -> list[ValidationIssue]:
    """Validate whether the inputs can support the requested report claims without guessing.

    The function deliberately fails closed. Missing data is not imputed from the prior DOCX or inferred
    by fuzzy matching. A caller may still build a DRAFT with review queues, but publication as a fully
    verified report is blocked until all ERROR issues are resolved.
    """
    src=set(available_sources)
    caps=set(available_capabilities)
    issues: list[ValidationIssue]=[]

    required=set(MANDATORY_CORE_SOURCES if require_core_sources else MANDATORY_MASTER_SOURCES)
    missing=sorted(required-src)
    if missing:
        issues.append(ValidationIssue(
            "ERROR", "INPUT_SOURCE_MISSING",
            "Mandatory authoritative input source(s) are missing",
            {"missing_sources": missing},
        ))

    missing_caps=[]
    for claim in requested_claims:
        needed=CLAIM_CAPABILITIES.get(claim)
        if needed and needed not in caps:
            missing_caps.append({"claim": claim, "required_capability": needed})
    if missing_caps:
        issues.append(ValidationIssue(
            "ERROR", "INPUT_CAPABILITY_MISSING",
            "Requested report claim cannot be proven from the available inputs",
            {"missing": missing_caps},
        ))

    unresolved=sorted(str(x) for x in unresolved_critical_items if str(x).strip())
    if unresolved:
        issues.append(ValidationIssue(
            "ERROR", "CRITICAL_INPUT_UNRESOLVED",
            "Critical source ambiguity remains unresolved; publication would require guessing",
            {"items": unresolved},
        ))
    return issues


def summarize_input_contract(*, available_sources: Iterable[str], available_capabilities: Iterable[str],
                             requested_claims: Iterable[str], unresolved_critical_items: Iterable[str]) -> InputContractResult:
    src=set(available_sources); caps=set(available_capabilities)
    missing_sources=tuple(sorted(set(MANDATORY_CORE_SOURCES)-src))
    missing_caps=[]
    for claim in requested_claims:
        needed=CLAIM_CAPABILITIES.get(claim)
        if needed and needed not in caps:
            missing_caps.append(needed)
    unresolved=tuple(sorted(str(x) for x in unresolved_critical_items if str(x).strip()))
    return InputContractResult(
        complete=not missing_sources and not missing_caps and not unresolved,
        missing_sources=missing_sources,
        missing_capabilities=tuple(sorted(set(missing_caps))),
        unresolved_critical_items=unresolved,
    )
