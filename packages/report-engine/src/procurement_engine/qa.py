from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable, Sequence

from .fact_model import is_procurement_row
from .models import ProcurementRow, ValidationIssue
from .normalize import (
    NO_DATE_MARKERS,
    clean_text,
    normalize_id,
    normalize_method,
    parse_date,
    parse_integer,
    to_decimal,
)
from .rule_catalog import DEFAULT_RULE_CATALOG

_X = {"", "x", "х", "-", "—"}


def _cell(row: Sequence, idx: int):
    return row[idx] if idx < len(row) else None


def _num(v) -> float:
    try:
        return float(to_decimal(v))
    except ValueError:
        return 0.0


def _blank_marker(v) -> bool:
    return clean_text(v).casefold() in _X


def _year_from_date(v) -> int | None:
    d = parse_date(v)
    return int(d[:4]) if d else None


def _quarter_from_date(v) -> int | None:
    d = parse_date(v)
    if not d:
        return None
    m = int(d[5:7])
    return (m - 1) // 3 + 1


def source_row_key(source_id: str, sheet_name: str, row_number: int, procurement_id: str | None) -> str:
    """Physical row identity. Column A is a business label, not a unique database key."""
    locator = f"{source_id}::{sheet_name}::{row_number}"
    label = normalize_id(procurement_id) or f"__ROW__::{locator}"
    return f"{locator}::{label}"


def validate_master_values(values: Iterable[Sequence], *, grbs: str, source_id: str,
                           sheet_name: str, first_sheet_row: int = 4,
                           amount_tol: float = 0.02) -> list[ValidationIssue]:
    """QA the raw A:AH source before any KPI or procedure overlay is applied."""
    issues: list[ValidationIssue] = []
    ids: dict[str, list[int]] = defaultdict(list)

    for offset, row in enumerate(values):
        rn = first_sheet_row + offset
        pid = normalize_id(_cell(row, 0))
        # Blank A is a valid business row, including for raw arithmetic and date QA.
        if not any(clean_text(_cell(row, i)) for i in (0, 5, 6, 11, 13, 15, 16, 21, 22, 23)):
            continue
        if pid:
            ids[pid].append(rn)
        ctx = {"grbs": grbs, "source_id": source_id, "sheet": sheet_name,
               "row": rn, "procurement_id": pid, "row_key": source_row_key(source_id, sheet_name, rn, pid)}

        for column, label, maximum in ((14, 'PLAN_QUARTER', 4), (15, 'PLAN_YEAR', 9999),
                                        (17, 'FACT_QUARTER', 4), (18, 'FACT_YEAR', 9999)):
            raw = _cell(row, column)
            if clean_text(raw).casefold() in NO_DATE_MARKERS:
                continue
            number = parse_integer(raw)
            if number is None or not 1 <= number <= maximum:
                issues.append(ValidationIssue('ERROR', 'INVALID_' + label,
                    f'{grbs} row {rn}: calendar period must be a valid whole number', ctx))
        for column, label in ((13, 'PLAN_DATE'), (16, 'FACT_DATE')):
            raw = _cell(row, column)
            if clean_text(raw).casefold() not in NO_DATE_MARKERS and parse_date(raw) is None:
                issues.append(ValidationIssue('ERROR', 'INVALID_' + label,
                    f'{grbs} row {rn}: invalid calendar date cannot be treated as a missing date', ctx))

        plan = [_num(_cell(row, i)) for i in (7, 8, 9)]
        fact = [_num(_cell(row, i)) for i in (21, 22, 23)]
        saving = [_num(_cell(row, i)) for i in (25, 26, 27)]
        stored_plan, stored_fact, stored_saving = (_num(_cell(row, 10)), _num(_cell(row, 24)), _num(_cell(row, 28)))
        for code, stored, calc in (
            ("PLAN_TOTAL_MISMATCH", stored_plan, sum(plan)),
            ("FACT_TOTAL_MISMATCH", stored_fact, sum(fact)),
            ("SAVING_TOTAL_MISMATCH", stored_saving, sum(saving)),
        ):
            if abs(stored - calc) > amount_tol:
                issues.append(ValidationIssue("ERROR", code, f"{grbs} row {rn}: stored total differs from components",
                                              {**ctx, "stored": stored, "calculated": calc}))

        planned_date = _cell(row, 13)
        pq = int(_num(_cell(row, 14))) if _num(_cell(row, 14)) in (1, 2, 3, 4) else None
        py = parse_integer(_cell(row, 15))
        dy, dq = _year_from_date(planned_date), _quarter_from_date(planned_date)
        if dy and py and dy != py:
            issues.append(ValidationIssue("ERROR", "PLAN_YEAR_DATE_MISMATCH", f"{grbs} row {rn}: P != year(N)", ctx))
        if dq and pq and dq != pq:
            issues.append(ValidationIssue("ERROR", "PLAN_QUARTER_DATE_MISMATCH", f"{grbs} row {rn}: O != quarter(N)", ctx))

        actual_date = _cell(row, 16)
        fq = int(_num(_cell(row, 17))) if _num(_cell(row, 17)) in (1, 2, 3, 4) else None
        fy = parse_integer(_cell(row, 18))
        ay, aq = _year_from_date(actual_date), _quarter_from_date(actual_date)
        if ay and fy and ay != fy:
            issues.append(ValidationIssue("ERROR", "FACT_YEAR_DATE_MISMATCH", f"{grbs} row {rn}: S != year(Q)", ctx))
        if aq and fq and aq != fq:
            issues.append(ValidationIssue("ERROR", "FACT_QUARTER_DATE_MISMATCH", f"{grbs} row {rn}: R != quarter(Q)", ctx))

        fact_total = sum(fact)
        has_date = bool(parse_date(actual_date))
        if fact_total > amount_tol and not has_date:
            issues.append(ValidationIssue(
                "WARN", "MONETARY_FACT_WITHOUT_COMPLETION_DATE",
                f"{grbs} row {rn}: V:W:X contain fact but Q has no date; monetary fact != completed procurement",
                {**ctx, "fact_total": fact_total, "fact_date_raw": clean_text(actual_date)}))
        if has_date and fact_total <= amount_tol:
            issues.append(ValidationIssue(
                "WARN", "COMPLETION_DATE_WITH_ZERO_FACT",
                f"{grbs} row {rn}: Q has a date but V:W:X are zero", ctx))

        if py is not None and not normalize_method(_cell(row, 11)):
            issues.append(ValidationIssue(
                "ERROR", "METHOD_UNKNOWN_FOR_PLANNED_ROW",
                f"{grbs} row {rn}: L is empty or contains an unsupported procurement method",
                {**ctx, "method_raw": clean_text(_cell(row, 11)), "planned_year": py},
            ))

    for pid, rows in ids.items():
        if len(rows) > 1:
            issues.append(ValidationIssue(
                "WARN", "DUPLICATE_BUSINESS_ID",
                f"{grbs}: A={pid} occurs on multiple rows; A alone cannot be a stable identity key",
                {"grbs": grbs, "source_id": source_id, "sheet": sheet_name, "procurement_id": pid, "rows": rows}))
    return issues


def derive_master_model(rows: Iterable[ProcurementRow], *, report_year: int) -> dict:
    """Independent master-only aggregation. No procedure overlays are allowed here."""
    def blank():
        return {"plan_count": 0, "fact_count": 0, "remain_count": 0,
                "plan_amount": 0.0, "fact_amount": 0.0, "remain_amount": 0.0}
    out: dict[str, dict] = {}
    for r in rows:
        if not is_procurement_row(r, report_year=report_year):
            continue
        typ = "ep" if r.method == "ЕП" else "comp"
        g = out.setdefault(r.grbs, {"comp": {"year": blank(), **{f"q{i}": blank() for i in range(1, 5)}},
                                     "ep": {"year": blank(), **{f"q{i}": blank() for i in range(1, 5)}}})
        scopes = ["year"] + ([f"q{r.planned_quarter}"] if r.planned_quarter in (1, 2, 3, 4) else [])
        for scope in scopes:
            m = g[typ][scope]
            m["plan_count"] += 1
            m["plan_amount"] += r.plan_total
            if r.has_recorded_fact:
                m["fact_count"] += 1
                m["fact_amount"] += r.fact_total
            else:
                m["remain_count"] += 1
                m["remain_amount"] += r.plan_total
    return out


def compare_declared_to_derived(declared_model: dict, derived_model: dict, *, amount_tol: float = 0.02) -> list[ValidationIssue]:
    """Blocks circular validation: compare report model to a fresh aggregation of normalized source rows."""
    issues: list[ValidationIssue] = []
    for grbs, d in derived_model.items():
        if grbs not in declared_model:
            issues.append(ValidationIssue("ERROR", "DERIVED_GRBS_MISSING", f"{grbs}: missing from declared model"))
            continue
        for typ in ("comp", "ep"):
            for scope in ("year", "q1", "q2", "q3", "q4"):
                got = declared_model[grbs][typ][scope]
                exp = d[typ][scope]
                # Support both old nested amount blocks and v2 flat amounts.
                got_plan_amt = float((got.get("plan") or {}).get("K", got.get("plan_amount", 0)))
                got_fact_amt = float((got.get("fact") or {}).get("Y", got.get("fact_amount", 0)))
                fields = [
                    ("plan_count", int(got.get("plan_count", 0)), int(exp["plan_count"])),
                    ("fact_count", int(got.get("fact_count", 0)), int(exp["fact_count"])),
                ]
                for field, a, b in fields:
                    if a != b:
                        issues.append(ValidationIssue("ERROR", "MODEL_DERIVATION_MISMATCH",
                                                      f"{grbs}/{typ}/{scope}/{field}: declared {a}, derived {b}"))
                if abs(got_plan_amt - exp["plan_amount"]) > amount_tol or abs(got_fact_amt - exp["fact_amount"]) > amount_tol:
                    issues.append(ValidationIssue("ERROR", "MODEL_AMOUNT_DERIVATION_MISMATCH",
                                                  f"{grbs}/{typ}/{scope}: declared amounts differ from source-derived model",
                                                  {"declared_plan": got_plan_amt, "derived_plan": exp["plan_amount"],
                                                   "declared_fact": got_fact_amt, "derived_fact": exp["fact_amount"]}))
    return issues


def assess_procedure_binding(*, explicit_code_link: bool, same_grbs: bool, same_institution: bool,
                             subject_similarity: float | None, amount_relative_diff: float | None,
                             unique_candidate: bool = True, active_newer_attempt: bool = False,
                             procedure_kind: str = "procedure", manual_override: bool = False,
                             persisted_reviewed_binding: bool = False) -> dict:
    """Evidence-based binding used by QA and future ProcedureLifecycle.

    Fuzzy text alone never proves identity. Explicit code is strong evidence, but stale codes, cross-GRBS
    collisions and large amount differences can invalidate it. A no-code match can only create a review
    proposal; it becomes publishable only after a persisted reviewed binding exists.
    """
    sim = subject_similarity if subject_similarity is not None else 0.0
    diff = amount_relative_diff if amount_relative_diff is not None else 999.0
    rules = DEFAULT_RULE_CATALOG
    evidence = {
        "explicit_code_link": explicit_code_link, "same_grbs": same_grbs,
        "same_institution": same_institution, "subject_similarity": subject_similarity,
        "amount_relative_diff": amount_relative_diff, "unique_candidate": unique_candidate,
        "active_newer_attempt": active_newer_attempt, "procedure_kind": procedure_kind,
        "manual_override": manual_override, "persisted_reviewed_binding": persisted_reviewed_binding,
    }
    if manual_override or persisted_reviewed_binding:
        return {"decision": "RELIABLE_REVIEWED", "reliable": True, "reason": "persisted human-reviewed binding", "evidence": evidence}
    if active_newer_attempt:
        return {"decision": "REJECT_STALE_CODE", "reliable": False, "reason": "newer active attempt supersedes old procedure evidence", "evidence": evidence}
    if not same_grbs:
        return {"decision": "REJECT_CROSS_GRBS", "reliable": False, "reason": "procedure belongs to another GRBS", "evidence": evidence}
    if explicit_code_link:
        if diff <= rules.explicit_exact_amount_diff and sim >= rules.explicit_exact_subject_similarity:
            return {"decision": "RELIABLE_EXPLICIT", "reliable": True, "reason": "code + GRBS + amount + compatible subject", "evidence": evidence}
        if diff <= rules.explicit_compatible_amount_diff and sim >= rules.explicit_strong_subject_similarity:
            return {"decision": "RELIABLE_EXPLICIT", "reliable": True, "reason": "code + GRBS + strong subject + compatible amount", "evidence": evidence}
        return {"decision": "REVIEW_EXPLICIT_CONFLICT", "reliable": False, "reason": "explicit code conflicts with amount/subject evidence", "evidence": evidence}
    if not unique_candidate:
        return {"decision": "REVIEW_AMBIGUOUS", "reliable": False, "reason": "more than one plausible procedure candidate", "evidence": evidence}
    # v0.8 policy: inference without an explicit source link can propose a binding but can never publish KPI.
    # A reviewed relation must be persisted and supplied on later runs.
    if same_institution and diff <= rules.inferred_exact_amount_diff and sim >= rules.inferred_strong_subject_similarity:
        return {"decision": "REVIEW_STRONG_INFERRED", "reliable": False, "reason": "strong no-code candidate; persist reviewed binding before use", "evidence": evidence}
    if same_institution and diff <= rules.inferred_compatible_amount_diff and sim >= rules.inferred_compatible_subject_similarity:
        return {"decision": "REVIEW_INFERRED", "reliable": False, "reason": "plausible no-code match requires review", "evidence": evidence}
    return {"decision": "REJECT_INFERRED", "reliable": False, "reason": "insufficient independent evidence", "evidence": evidence}


def explicit_future_plan_dates(text: str, target_year: int) -> set[str]:
    """Legacy proposals for procurement timing, not dates of delivery or performance."""
    dates = set()
    for match in re.finditer(r'\bзапланировано\s+(?:на\s+)?(\d{2}\.\d{2}\.\d{4})(?!\d)', text, re.IGNORECASE):
        if re.search(r'\b(?:изготовление|исполнение|выполнение|оказание|оплата|поставка)\s*$',
                     text[:match.start()], re.IGNORECASE):
            continue
        date = parse_date(match[1])
        if date and date.startswith(f'{target_year}-'):
            dates.add(date)
    return dates


def classify_future_context(raw_row: Sequence, *, target_year: int) -> str:
    """Classify a future-year mention without confusing it with procurement timing.

    This is a migration classifier for unstructured legacy rows.  New data should
    carry explicit target_plan_year/month, service period, funding year and deadline
    fields.  Phrase matching may propose a class but never invent a missing month.
    """
    planned_date = parse_date(_cell(raw_row, 13))
    planned_year = parse_integer(_cell(raw_row, 15))
    year_s = str(target_year)
    if planned_year == target_year or (planned_date and planned_date.startswith(f"{target_year}-")):
        return f"STRUCTURED_PLAN_{target_year}"

    text = " ".join(clean_text(_cell(raw_row, i)).casefold() for i in (4, 6, 12, 20, 30, 31, 32, 33))
    if year_s not in text:
        return f"NO_{target_year}_REFERENCE"

    no_structured_plan = planned_year is None and planned_date is None
    target_phrases = (
        f"поставили в план на {year_s}",
        f"за счет средств планового периода со сроком выполнения в {year_s}",
        f"за счёт средств планового периода со сроком выполнения в {year_s}",
        f"план на {year_s}", f"запланировано на {year_s}",
    )
    if no_structured_plan and (any(p in text for p in target_phrases) or explicit_future_plan_dates(text, target_year)):
        return f"TARGET_PLAN_{target_year}_UNSTRUCTURED"
    if "ассигнован" in text and "планов" in text and year_s in text:
        return f"MULTIYEAR_FUNDING_{target_year}"
    if any(p in text for p in (f"до 01.01.{year_s}", f"до 01.{year_s}", "предписан")):
        return f"DEADLINE_OR_REQUIREMENT_{target_year}"
    if planned_year is not None and planned_year < target_year and any(p in text for p in (
        f"на {year_s} год", f"в {year_s} году", f"на начало {year_s}", f"запас на {year_s}",
        f"первое полугодие {year_s}", "переходящ", f"договор заключается на {year_s}",
        f"услуг в {year_s}", f"изготовление запланировано на январь {year_s}",
    )):
        return f"PROCUREMENT_{planned_year}_FOR_{target_year}_NEED"
    return f"OTHER_{target_year}_REFERENCE"


def classify_2027_context(raw_row: Sequence) -> str:
    """Compatibility wrapper for the 2026→2027 migration QA fixture."""
    return classify_future_context(raw_row, target_year=2027)


def freshness_gate(before: dict[str, str | None], after: dict[str, str | None]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for source_id in sorted(set(before) | set(after)):
        b, a = before.get(source_id), after.get(source_id)
        if b != a:
            issues.append(ValidationIssue("ERROR", "SOURCE_CHANGED_DURING_FREEZE",
                                          f"{source_id}: source changed while snapshot was being built",
                                          {"before": b, "after": a}))
    return issues
