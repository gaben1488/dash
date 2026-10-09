"""Recorded procedure facts for the executive briefing; no inferred contracts.

One canonical working-procedure registry is reused. Every value is a projection
of an explicitly captured source cell, not a separate document/ledger.
"""
from __future__ import annotations

from dataclasses import asdict

from .normalize import clean_text, normalize_procedure_code, parse_date

CONTRACT = "operational-procedure-evidence-v1"


def build_operational_evidence(attempts, shares, raw_values):
    by_ref = {str(attempt.source_ref): attempt for attempt in attempts}
    rows = []
    for row_no, source in enumerate(raw_values, 1):
        code = normalize_procedure_code(source[0] if source else None)
        if not code or clean_text(source[1] if len(source) > 1 else "").casefold() == "доля":
            continue
        # The caller supplied fully normalized attempts with stable row provenance.
        matches = [attempt for reference, attempt in by_ref.items()
                   if reference.endswith("!" + str(row_no))]
        if len(matches) != 1 or matches[0].procedure_code != code:
            raise ValueError("OPERATIONAL_PROCEDURE_PROVENANCE_INVALID")
        attempt = matches[0]
        item = asdict(attempt)
        for key, column in (("application_date", 8), ("publication_date", 9),
                            ("application_end_date", 10), ("results_date", 11)):
            value = source[column] if column < len(source) else None
            item[key] = parse_date(value)
        rows.append(item)
    if len(rows) != len(attempts):
        raise ValueError("OPERATIONAL_PROCEDURE_COVERAGE_INVALID")
    return {"contract": CONTRACT, "attempts": rows, "shares": [asdict(share) for share in shares]}
