from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

NO_DATE_MARKERS = {"", "x", "х", "-", "—", "нет", "none", "null"}


def clean_text(value) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_id(value) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    if re.fullmatch(r"\d+\.0", text):
        text = text[:-2]
    return text


def normalize_method(value) -> str | None:
    """Compatibility wrapper around the versioned canonical RuleCatalog."""
    from .rule_catalog import DEFAULT_RULE_CATALOG
    return DEFAULT_RULE_CATALOG.normalize_method(value)



def normalize_grbs(value) -> str | None:
    """Compatibility wrapper around the versioned canonical RuleCatalog."""
    from .rule_catalog import DEFAULT_RULE_CATALOG
    return DEFAULT_RULE_CATALOG.normalize_grbs(value)


def normalize_procedure_code(value) -> str | None:
    """Normalize only syntactically valid procurement procedure codes; headers fail closed."""
    from .rule_catalog import DEFAULT_RULE_CATALOG
    return DEFAULT_RULE_CATALOG.normalize_procedure_code(value)


def parse_date(value) -> str | None:
    if isinstance(value, bool):
        return None
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    # Google Sheets UNFORMATTED_VALUE and exported XLSX can expose dates as spreadsheet serials.
    # Excel/Sheets use the 1899-12-30 compatibility epoch for modern dates.
    if isinstance(value, (int, float)) and 1 <= float(value) <= 200000:
        try:
            return (date(1899, 12, 30) + timedelta(days=float(value))).isoformat()
        except (OverflowError, ValueError):
            pass
    text = clean_text(value)
    if text.casefold() in NO_DATE_MARKERS:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d.%m.%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()  # noqa: DTZ007 — civil report date, not an instant.
        except ValueError:
            pass
    return None


def to_decimal(value) -> Decimal:
    if value is None or clean_text(value) == "":
        return Decimal(0)
    if isinstance(value, bool):
        raise ValueError('Boolean is not money')  # noqa: TRY004 — public validation contract uses ValueError.
    if isinstance(value, (int, float, Decimal)):
        result = Decimal(str(value))
        if not result.is_finite():
            raise ValueError('Non-finite money')
        return result
    text = clean_text(value).replace(" ", "").replace(",", ".")
    try:
        result = Decimal(text)
        if not result.is_finite():
            raise ValueError('Non-finite money')
        return result
    except InvalidOperation as exc:
        raise ValueError(f"Not a numeric value: {value!r}") from exc


def meaningful(value) -> bool:
    return bool(clean_text(value))
