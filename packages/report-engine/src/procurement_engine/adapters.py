from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence

from .constants import ROW_MAPPING
from .models import ProcurementRow
from .normalize import (
    clean_text,
    normalize_id,
    normalize_method,
    parse_date,
    parse_integer,
    to_decimal,
)

COLS = [
    "A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U",
    "V","W","X","Y","Z","AA","AB","AC","AD","AE","AF","AG","AH"
]


def _cell(row: Sequence, idx: int):
    return row[idx] if idx < len(row) else None


def _as_int(value):
    return parse_integer(value)


def normalize_master_values(values: Iterable[Sequence], *, snapshot_id: str, expected_grbs: str | None = None,
                            data_start_row: int = 1, source_id: str = "", sheet_name: str = "",
                            first_sheet_row: int = 1,
                            procurement_uid_map: Mapping[str, str] | None = None) -> list[ProcurementRow]:
    """Normalize an already-fetched A:AH values matrix.

    Row existence is deliberately NOT defined by column A or B. Real 29.09 data contains
    valid procurement rows with blank A and valid rows with blank B. The sheet/source
    context supplies GRBS ownership, while column A remains a non-unique business label.

    The normalizer retains any row with a subject and procurement-shaped content. Whether
    the row belongs to a particular report projection is decided later by one canonical
    predicate (`is_procurement_row`) rather than by ad-hoc A/B checks.
    """
    out: list[ProcurementRow] = []
    for matrix_index, raw in enumerate(list(values)[data_start_row:], start=data_start_row):
        sheet_row = first_sheet_row + matrix_index
        source_row_no = normalize_id(_cell(raw, 0))
        subject = clean_text(_cell(raw, 6))
        activity_kind = clean_text(_cell(raw, 5))
        method = normalize_method(_cell(raw, 11))
        planned_date = parse_date(_cell(raw, 13))
        planned_year = _as_int(_cell(raw, 15))
        actual_date = parse_date(_cell(raw, 16))
        plan_parts = [to_decimal(_cell(raw, i)) for i in (7, 8, 9)]
        fact_parts = [to_decimal(_cell(raw, i)) for i in (21, 22, 23)]

        # Do not use A/B as a row-existence predicate. Skip only clearly non-data rows.
        has_procurement_shape = bool(subject) and any([
            activity_kind, method, planned_date, planned_year, actual_date,
            any(x != 0 for x in plan_parts), any(x != 0 for x in fact_parts),
        ])
        if not has_procurement_shape:
            continue

        source_grbs = clean_text(_cell(raw, 1))
        # The source registry/workbook ownership is authoritative for GRBS. Column B is descriptive
        # and may be blank or use long/legacy aliases (e.g. "УАГЗО АЕМР"). Do not reject a valid
        # row because B is not an exact canonical abbreviation.
        grbs = expected_grbs or source_grbs
        if not grbs:
            raise ValueError(f"MISSING_GRBS_CONTEXT for source row {sheet_row}: column B blank and expected_grbs not supplied")

        # A is not a primary key and may be blank. Use a physical fallback only for this
        # snapshot; production should persist an immutable procurement_uid in IdentityLedger.
        physical_locator = f"{source_id or grbs}::{sheet_name or 'SHEET'}::{sheet_row}"
        pid = source_row_no or f"__ROW__::{physical_locator}"
        uid = None
        if procurement_uid_map is not None:
            # Persisted identity ledgers may key either by the physical locator alone or
            # by a locator including the optional business label. Never fall back to A-only.
            uid = procurement_uid_map.get(f"{physical_locator}::{source_row_no or ''}") or procurement_uid_map.get(physical_locator)
        include_text = clean_text(_cell(raw, 29)).casefold()
        include_saving = True if include_text == "да" else False if include_text == "нет" else None
        out.append(ProcurementRow(
            snapshot_id=snapshot_id,
            procurement_id=pid,
            procurement_uid=uid,
            missing_money_fields=tuple(COLS[i] for i in (7,8,9,21,22,23,25,26,27) if not clean_text(_cell(raw,i))),
            grbs=grbs,
            institution=clean_text(_cell(raw, 2)),
            activity_kind=activity_kind,
            source_row_no=source_row_no,
            subject=subject,
            method=method,
            planned_date=planned_date,
            planned_quarter=_as_int(_cell(raw, 14)),
            planned_year=planned_year,
            actual_date=actual_date,
            plan_fb=float(plan_parts[0]),
            plan_kb=float(plan_parts[1]),
            plan_mb=float(plan_parts[2]),
            stored_plan_total=float(to_decimal(_cell(raw, 10))) if clean_text(_cell(raw, 10)) else None,
            deviation_reason=clean_text(_cell(raw, 20)),
            fact_fb=float(fact_parts[0]),
            fact_kb=float(fact_parts[1]),
            fact_mb=float(fact_parts[2]),
            stored_fact_total=float(to_decimal(_cell(raw, 24))) if clean_text(_cell(raw, 24)) else None,
            saving_fb=float(to_decimal(_cell(raw, 25))),
            saving_kb=float(to_decimal(_cell(raw, 26))),
            saving_mb=float(to_decimal(_cell(raw, 27))),
            stored_saving_total=float(to_decimal(_cell(raw, 28))) if clean_text(_cell(raw, 28)) else None,
            include_saving=include_saving,
            grbs_comment=clean_text(_cell(raw, 31)),
            procedure_code=clean_text(_cell(raw, 32)),
            monitoring_note=clean_text(_cell(raw, 33)),
            source_id=source_id,
            sheet_name=sheet_name,
            row_number=sheet_row,
        ))
    return out


def mapping_contract() -> dict[str, str]:
    return dict(ROW_MAPPING)
